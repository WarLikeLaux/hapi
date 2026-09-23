import { spawn, type ChildProcess } from 'node:child_process'
import { createInterface } from 'node:readline'
import { accessSync, constants, statSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { homedir } from 'node:os'
import type { QuotaUnavailableReason, QuotaWindow } from '@hapi/protocol/quotas'
import { clampPercent, errorMessage, type CollectorResult } from '../types'

export const CODEX_WEEKLY_SOURCE = 'codex:weekly'
export const CODEX_FIVE_HOUR_SOURCE = 'codex:5h'
const WEEKLY_WINDOW_MINUTES = 10080
const FIVE_HOUR_WINDOW_MINUTES = 300
const CODEX_TIMEOUT_MS = 30_000

export type CodexRateLimits = Record<string, unknown>

function windowSource(windowDurationMins: number): string | null {
    if (windowDurationMins === WEEKLY_WINDOW_MINUTES) return CODEX_WEEKLY_SOURCE
    if (windowDurationMins === FIVE_HOUR_WINDOW_MINUTES) return CODEX_FIVE_HOUR_SOURCE
    return null
}

/**
 * Codex `account/rateLimits/read` snapshot: `{ primary: {...}, secondary: {...} }`.
 * On different plans the weekly window sits in either key, so both are matched
 * by `windowDurationMins`; the 5-hour window rides along in the other slot.
 */
export function parseCodexWindows(rateLimits: unknown, nowSec: number): QuotaWindow[] {
    if (typeof rateLimits !== 'object' || rateLimits === null) return []
    const windows: QuotaWindow[] = []
    for (const slot of Object.values(rateLimits as CodexRateLimits)) {
        if (typeof slot !== 'object' || slot === null) continue
        const entry = slot as Record<string, unknown>
        if (typeof entry.windowDurationMins !== 'number') continue
        const source = windowSource(entry.windowDurationMins)
        if (!source) continue
        if (typeof entry.usedPercent !== 'number') continue
        windows.push({
            source,
            usedPercent: clampPercent(entry.usedPercent),
            resetsAt: typeof entry.resetsAt === 'number' ? Math.round(entry.resetsAt) : null,
            measuredAt: nowSec
        })
    }
    return windows
}

export function codexErrorReason(error: string): QuotaUnavailableReason {
    return error.includes('token_expired') || error.includes('401') ? 'auth_expired' : 'unavailable'
}

function isExecutableFile(path: string): boolean {
    try {
        accessSync(path, constants.X_OK)
        return statSync(path).isFile()
    } catch {
        return false
    }
}

// POSIX spawn reports a missing binary asynchronously, so the candidates are
// resolved up front instead of relying on sequential spawn attempts.
function resolveCodexBinary(): string | null {
    const names = process.platform === 'win32' ? ['codex.exe', 'codex.cmd'] : ['codex']
    for (const dir of (process.env.PATH ?? '').split(delimiter)) {
        if (!dir) continue
        for (const name of names) {
            const candidate = join(dir, name)
            if (isExecutableFile(candidate)) return candidate
        }
    }
    const fallback = join(homedir(), '.local', 'bin', 'codex')
    return isExecutableFile(fallback) ? fallback : null
}

async function requestRateLimits(): Promise<unknown> {
    const binary = resolveCodexBinary()
    if (!binary) {
        throw Object.assign(new Error('codex CLI not found'), { code: 'ENOENT' })
    }
    // Extensionless POSIX paths exec fine; Windows .cmd launchers need a shell.
    const child = spawn(binary, ['app-server'], {
        stdio: ['pipe', 'pipe', 'ignore'],
        shell: binary.toLowerCase().endsWith('.cmd')
    })

    return await new Promise((resolve, reject) => {
        const requests = [
            JSON.stringify({ id: 1, method: 'initialize', params: { clientInfo: { name: 'hapi', version: '1.0' } } }),
            JSON.stringify({ method: 'initialized' }),
            JSON.stringify({ id: 2, method: 'account/rateLimits/read', params: {} })
        ].join('\n') + '\n'

        const timer = setTimeout(() => {
            reject(new Error('codex did not respond in time'))
        }, CODEX_TIMEOUT_MS)

        const readline = createInterface({ input: child.stdout! })
        readline.on('line', (line: string) => {
            let event: unknown
            try {
                event = JSON.parse(line)
            } catch {
                return
            }
            if (typeof event !== 'object' || event === null || (event as Record<string, unknown>).id !== 2) {
                return
            }
            clearTimeout(timer)
            const response = event as Record<string, unknown>
            if ('error' in response) {
                reject(new Error(JSON.stringify(response.error)))
                return
            }
            const result = response.result as Record<string, unknown> | null
            resolve(result?.rateLimits)
        })
        child.on('error', (error) => {
            clearTimeout(timer)
            reject(error)
        })

        // stdin stays open until the response arrives: app-server exits on EOF
        // without answering if the pipe closes early. Cleanup is a kill below.
        child.stdin?.write(requests)
    }).finally(() => {
        child.kill()
    })
}

export async function collectCodexQuotas(nowSec: number): Promise<CollectorResult> {
    let rateLimits: unknown
    try {
        rateLimits = await requestRateLimits()
    } catch (error) {
        const message = errorMessage(error)
        if ((error as NodeJS.ErrnoException | null)?.code === 'ENOENT' || message.includes('not found')) {
            // No Codex CLI on this machine — not an error worth reporting.
            return { kind: 'skipped' }
        }
        return {
            kind: 'unavailable',
            source: CODEX_WEEKLY_SOURCE,
            reason: codexErrorReason(message),
            detail: message.slice(0, 200)
        }
    }
    const windows = parseCodexWindows(rateLimits, nowSec)
    if (windows.length === 0) {
        // Free plans carry no rate-limit windows at all; treat as "nothing to show".
        return { kind: 'skipped' }
    }
    return { kind: 'ok', windows }
}
