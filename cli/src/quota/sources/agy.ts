import { readdirSync, readFileSync, readlinkSync, statSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { QuotaWindow } from '@hapi/protocol/quotas'
import { clampPercent, type CollectorResult } from '../types'

export const AGY_SOURCE_PREFIX = 'agy'
export const AGY_BUCKETS = { '5h': 'gemini-5h', weekly: 'gemini-weekly' } as const
export type AgyWindowKind = keyof typeof AGY_BUCKETS

const AGY_SERVICE_PATH = '/exa.language_server_pb.LanguageServerService/'
const AGY_CALL_TIMEOUT_MS = 10_000

export type AgyTarget = { port: number; csrfToken: string | null }

export function agySourceId(accountPrefix: string, kind: AgyWindowKind): string {
    return `${AGY_SOURCE_PREFIX}:${accountPrefix}:${kind}`
}

export function defaultAgyRuntimeDir(env: NodeJS.ProcessEnv = process.env): string {
    return env.XDG_RUNTIME_DIR || `/run/user/${process.getuid?.() ?? 1000}`
}

function isAgyWindowSource(source: string): boolean {
    const parts = source.split(':')
    return parts.length === 3 && parts[0] === AGY_SOURCE_PREFIX && (parts[2] === '5h' || parts[2] === 'weekly')
}

/** Parses one published `{ ports: [...], csrf_token?: ... }` file payload. */
export function parsePublishedAgyTargets(payload: unknown): AgyTarget[] {
    if (typeof payload !== 'object' || payload === null) return []
    const record = payload as Record<string, unknown>
    const csrfToken = typeof record.csrf_token === 'string' && record.csrf_token ? record.csrf_token : null
    if (!Array.isArray(record.ports)) return []
    const targets: AgyTarget[] = []
    for (const port of record.ports) {
        if (typeof port === 'number' && Number.isInteger(port) && port > 0 && port <= 65535) {
            targets.push({ port, csrfToken })
        }
    }
    return targets
}

/** Targets published by parent wrappers (canary-hub's agy_session.py or the HAPI runner). */
async function publishedAgyTargets(runtimeDir: string): Promise<AgyTarget[]> {
    let files: string[]
    try {
        files = await readdir(join(runtimeDir, 'canary-agy'))
    } catch {
        return []
    }
    const targets: AgyTarget[] = []
    for (const file of files) {
        if (!file.endsWith('.json')) continue
        try {
            const payload = JSON.parse(await readFile(join(runtimeDir, 'canary-agy', file), 'utf8'))
            targets.push(...parsePublishedAgyTargets(payload))
        } catch {
            continue
        }
    }
    return targets
}

/**
 * Secondary Antigravity accounts run under an isolated HOME (canary-style
 * profiles); the main account is the instance on the runner's real home.
 */
export function isMainHomeAgyInstance(processHome: string | null, realHome: string): boolean {
    return !processHome || processHome === realHome
}

function agyProcessHome(pid: string): string | null {
    try {
        const entry = readFileSync(join('/proc', pid, 'environ'), 'utf8')
            .split('\0')
            .find((item) => item.startsWith('HOME='))
        return entry ? entry.slice('HOME='.length) : null
    } catch {
        return null
    }
}

/** Listening TCP ports of main-account `agy` processes, via /proc (Linux only). */
function processAgyPorts(): number[] {
    if (process.platform !== 'linux') return []
    const realHome = homedir()
    const inodes = new Set<string>()
    let procEntries: string[]
    try {
        procEntries = readdirSync('/proc')
    } catch {
        return []
    }
    for (const entry of procEntries) {
        if (!/^\d+$/.test(entry)) continue
        try {
            if (statSync(join('/proc', entry, 'comm')).isFile() && readFileSync(join('/proc', entry, 'comm'), 'utf8').trim() !== 'agy') {
                continue
            }
            if (!isMainHomeAgyInstance(agyProcessHome(entry), realHome)) {
                continue
            }
            for (const descriptor of readdirSync(join('/proc', entry, 'fd'))) {
                const target = readlinkSync(join('/proc', entry, 'fd', descriptor))
                if (target.startsWith('socket:[')) {
                    inodes.add(target.slice(8, -1))
                }
            }
        } catch {
            continue
        }
    }
    if (inodes.size === 0) return []
    const ports = new Set<number>()
    try {
        const rows = readFileSync('/proc/net/tcp', 'utf8').split('\n').slice(1)
        for (const row of rows) {
            const columns = row.trim().split(/\s+/)
            if (columns.length > 9 && columns[3] === '0A' && inodes.has(columns[9])) {
                ports.add(parseInt(columns[1].split(':')[1], 16))
            }
        }
    } catch {
        return []
    }
    return [...ports].sort((a, b) => a - b)
}

/**
 * Main-account language server targets. A live /proc scan (Linux) wins: only
 * ports owned by main-home `agy` processes are polled, so profiled secondary
 * accounts published by wrapper tools are dropped. Without a scannable
 * process, the published target files are kept as the fallback.
 */
export async function discoverAgyTargets(
    env: NodeJS.ProcessEnv = process.env,
    runtimeDir: string = defaultAgyRuntimeDir(env)
): Promise<AgyTarget[]> {
    const published = await publishedAgyTargets(runtimeDir)
    const processPorts = processAgyPorts()
    if (processPorts.length === 0) {
        return published
    }
    const csrfByPort = new Map(published.map((target) => [target.port, target.csrfToken]))
    const envToken = env.ANTIGRAVITY_CSRF_TOKEN || null
    return processPorts.map((port) => ({ port, csrfToken: csrfByPort.get(port) ?? envToken }))
}

async function agyCall(port: number, method: string, csrfToken: string | null): Promise<unknown | null> {
    try {
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'Connect-Protocol-Version': '1'
        }
        if (csrfToken) headers['X-Codeium-Csrf-Token'] = csrfToken
        const response = await fetch(`http://127.0.0.1:${port}${AGY_SERVICE_PATH}${method}`, {
            method: 'POST',
            headers,
            body: '{}',
            signal: AbortSignal.timeout(AGY_CALL_TIMEOUT_MS)
        })
        if (!response.ok) return null
        return await response.json()
    } catch {
        return null
    }
}

export function isoToUnixSeconds(value: unknown): number | null {
    if (typeof value !== 'string' || !value) return null
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? null : Math.floor(parsed / 1000)
}

export function agyWindowFromBucket(bucket: unknown, source: string, nowSec: number): QuotaWindow | null {
    if (typeof bucket !== 'object' || bucket === null) return null
    const entry = bucket as Record<string, unknown>
    if (typeof entry.remainingFraction !== 'number') return null
    const remaining = Math.min(1, Math.max(0, entry.remainingFraction))
    return {
        source,
        usedPercent: clampPercent((1 - remaining) * 100),
        resetsAt: isoToUnixSeconds(entry.resetTime),
        measuredAt: nowSec
    }
}

/** Extracts both tracked Gemini windows from a RetrieveUserQuotaSummary response. */
export function extractAgyWindows(response: unknown, sourceId: (kind: AgyWindowKind) => string, nowSec: number): QuotaWindow[] {
    if (typeof response !== 'object' || response === null) return []
    const windows: QuotaWindow[] = []
    const groups = (response as Record<string, unknown>).response as Record<string, unknown> | undefined
    const buckets = Array.isArray(groups?.groups)
        ? (groups!.groups as Array<Record<string, unknown>>).flatMap((group) => (Array.isArray(group.buckets) ? group.buckets : []))
        : []
    for (const bucket of buckets) {
        if (typeof bucket !== 'object' || bucket === null) continue
        const bucketId = (bucket as Record<string, unknown>).bucketId
        const kind = bucketId === AGY_BUCKETS['5h'] ? '5h' as const : bucketId === AGY_BUCKETS.weekly ? 'weekly' as const : null
        if (!kind) continue
        const quotaWindow = agyWindowFromBucket(bucket, sourceId(kind), nowSec)
        if (quotaWindow) windows.push(quotaWindow)
    }
    return windows
}

function accountPrefixFromStatus(status: unknown): string | null {
    const email = (status as Record<string, unknown> | null)?.userStatus as Record<string, unknown> | undefined
    const value = typeof email?.email === 'string' ? email.email : null
    const prefix = value?.split('@')[0]?.trim()
    return prefix ? prefix : null
}

/**
 * Polls every discoverable agy language server and merges measurements over
 * the previous snapshot. With live accounts present, only they are reported
 * (a profiled secondary account that stops running is dropped); when nothing
 * is live, the whole previous snapshot is kept so the UI can mark it stale.
 */
export async function collectAgyQuotas(previous: QuotaWindow[], nowSec: number): Promise<CollectorResult> {
    const targets = await discoverAgyTargets()
    const merged = new Map<string, QuotaWindow>()
    const livePrefixes = new Set<string>()

    for (const { port, csrfToken } of targets) {
        const status = await agyCall(port, 'GetUserStatus', csrfToken)
        const prefix = accountPrefixFromStatus(status)
        if (!prefix) continue
        livePrefixes.add(prefix)
        const summary = await agyCall(port, 'RetrieveUserQuotaSummary', csrfToken)
        if (!summary) continue
        for (const quotaWindow of extractAgyWindows(summary, (kind) => agySourceId(prefix, kind), nowSec)) {
            merged.set(quotaWindow.source, quotaWindow)
        }
    }

    if (livePrefixes.size > 0) {
        for (const quotaWindow of previous) {
            if (!isAgyWindowSource(quotaWindow.source)) continue
            const prefix = quotaWindow.source.split(':')[1]
            if (prefix && livePrefixes.has(prefix)) merged.set(quotaWindow.source, quotaWindow)
        }
    } else {
        for (const quotaWindow of previous) {
            if (isAgyWindowSource(quotaWindow.source)) merged.set(quotaWindow.source, quotaWindow)
        }
    }

    if (merged.size === 0) return { kind: 'skipped' }
    return { kind: 'ok', windows: [...merged.values()].sort((a, b) => a.source.localeCompare(b.source)) }
}
