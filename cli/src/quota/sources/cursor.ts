import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { QuotaWindow } from '@hapi/protocol/quotas'
import { clampPercent, errorMessage, type CollectorResult } from '../types'

export const CURSOR_MONTHLY_SOURCE = 'cursor:monthly'
const CURSOR_USAGE_URL = 'https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage'
const CURSOR_TIMEOUT_MS = 20_000
// Hard-coded backend sentinel for "no limit"; there is no meaningful percent then.
const UNLIMITED_SENTINEL = 2147483647
/** Platform auth.json locations holding the CLI OAuth token (`accessToken`). */
export function cursorAuthPaths(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string[] {
    switch (process.platform) {
        case 'darwin':
            return [join(home, '.cursor', 'auth.json')]
        case 'win32':
            return [join(env.APPDATA ?? join(home, 'AppData', 'Roaming'), 'Cursor', 'auth.json')]
        default:
            return [join(home, '.config', 'cursor', 'auth.json')]
    }
}

export async function readCursorAccessToken(paths: string[] = cursorAuthPaths()): Promise<string | null> {
    for (const path of paths) {
        try {
            const payload = JSON.parse(await readFile(path, 'utf8'))
            const token = (payload as Record<string, unknown>).accessToken
            if (typeof token === 'string' && token) return token
        } catch {
            continue
        }
    }
    return null
}

/**
 * GetCurrentPeriodUsage response → monthly spent percent. Cursor reports its
 * Cursor Models pool consumption (Composer & Grok) directly in
 * `planUsage.autoPercentUsed` (0–100 scale), matching the dashboard's
 * integer percent. Falls back to `totalPercentUsed`, then raw cents math
 * (`(limit − remaining) / limit` or `totalSpend / limit`).
 * Returns null when neither is usable or the account is unlimited.
 */
export function parseCursorMonthlyUsage(payload: unknown, nowSec: number): QuotaWindow | null {
    if (typeof payload !== 'object' || payload === null) return null
    const planUsage = (payload as Record<string, unknown>).planUsage
    if (typeof planUsage !== 'object' || planUsage === null) return null
    const entry = planUsage as Record<string, unknown>
    const resetMs = Number((payload as Record<string, unknown>).billingCycleEnd)
    const resetsAt = Number.isFinite(resetMs) && resetMs > 0 ? Math.floor(resetMs / 1000) : null

    const limit = typeof entry.limit === 'number' ? entry.limit : Number.NaN
    const remaining = typeof entry.remaining === 'number' ? entry.remaining : Number.NaN
    const spend = typeof entry.totalSpend === 'number'
        ? entry.totalSpend
        : typeof entry.includedSpend === 'number'
            ? entry.includedSpend
            : Number.NaN

    let usedCents: number | undefined
    let limitCents: number | undefined
    if (Number.isFinite(limit) && limit > 0 && limit !== UNLIMITED_SENTINEL) {
        limitCents = Math.round(limit)
        if (Number.isFinite(remaining)) {
            usedCents = Math.max(0, Math.round(limit - remaining))
        } else if (Number.isFinite(spend)) {
            usedCents = Math.max(0, Math.round(spend))
        }
    }

    // Cursor Models pool percentage reported directly by the backend (0–100 scale).
    // autoPercentUsed tracks the Composer & Grok pool shown on the Cursor dashboard.
    const poolPercent = typeof entry.autoPercentUsed === 'number'
        ? entry.autoPercentUsed
        : typeof entry.totalPercentUsed === 'number'
            ? entry.totalPercentUsed
            : undefined

    if (poolPercent !== undefined && Number.isFinite(poolPercent) && poolPercent >= 0 && poolPercent <= 100) {
        const percent = clampPercent(Math.round(poolPercent * 100) / 100)
        return {
            source: CURSOR_MONTHLY_SOURCE,
            usedPercent: percent,
            weightedPercent: percent,
            ...(usedCents !== undefined ? { usedCents } : {}),
            ...(limitCents !== undefined ? { limitCents } : {}),
            resetsAt,
            measuredAt: nowSec
        }
    }

    if (usedCents !== undefined && limitCents !== undefined && limitCents > 0) {
        const rawPercent = clampPercent(Math.round((usedCents / limitCents) * 10_000) / 100)
        return {
            source: CURSOR_MONTHLY_SOURCE,
            usedPercent: rawPercent,
            usedCents,
            limitCents,
            resetsAt,
            measuredAt: nowSec
        }
    }

    return null
}

export async function collectCursorQuota(nowSec: number, env: NodeJS.ProcessEnv = process.env): Promise<CollectorResult> {
    const token = await readCursorAccessToken(cursorAuthPaths(env))
    if (!token) return { kind: 'skipped' }

    try {
        const response = await fetch(CURSOR_USAGE_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'Connect-Protocol-Version': '1',
                'Authorization': `Bearer ${token}`
            },
            body: '{}',
            signal: AbortSignal.timeout(CURSOR_TIMEOUT_MS)
        })
        if (!response.ok) {
            return {
                kind: 'unavailable',
                source: CURSOR_MONTHLY_SOURCE,
                reason: response.status === 401 || response.status === 403 ? 'auth_expired' : 'unavailable',
                detail: `HTTP ${response.status}`
            }
        }
        const payload = await response.json()
        const quotaWindow = parseCursorMonthlyUsage(payload, nowSec)
        if (!quotaWindow) {
            return { kind: 'unavailable', source: CURSOR_MONTHLY_SOURCE, reason: 'unavailable', detail: 'planUsage not found in response' }
        }
        return { kind: 'ok', windows: [quotaWindow] }
    } catch (error) {
        return { kind: 'unavailable', source: CURSOR_MONTHLY_SOURCE, reason: 'unavailable', detail: errorMessage(error) }
    }
}
