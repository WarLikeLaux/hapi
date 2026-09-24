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
// Cursor does not publish how it weights the Cursor Models pool (Composer,
// Grok) against the included quota ("we don't officially publish the exact
// multiplier", forum staff, 2026-07). Every usage event reports requestsCosts
// = chargedCents / 4: either a pool weight or the legacy $0.04-per-request
// unit (product id "pro-legacy"). The dashboard's integer percent matches
// this divisor as of 2026-09 (62c/4 over 2000c rounds to "1%"). Re-derive by
// fitting requestsCosts against tokenUsage.totalCents from
// DashboardService/GetFilteredUsageEvents if the meters ever disagree.
const CURSOR_MODELS_WEIGHT = 4

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
 * GetCurrentPeriodUsage response → monthly spent percents. `usedPercent` is
 * the raw cents math (`limit − remaining`); `weightedPercent` applies the
 * Cursor Models pool factor (see CURSOR_MODELS_WEIGHT) so clients can mirror
 * the dashboard's own integer display. Cents math is preferred; the reported
 * `planUsage.totalPercentUsed` fraction (0–1) is the raw fallback and has no
 * weighted variant. Returns null when neither is usable or the account is
 * unlimited.
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
    if (Number.isFinite(limit) && limit > 0 && limit !== UNLIMITED_SENTINEL && Number.isFinite(remaining)) {
        const usedCents = Math.max(0, Math.round(limit - remaining))
        return {
            source: CURSOR_MONTHLY_SOURCE,
            usedPercent: clampPercent((usedCents / limit) * 100),
            weightedPercent: clampPercent((usedCents / CURSOR_MODELS_WEIGHT / limit) * 100),
            usedCents,
            limitCents: Math.round(limit),
            resetsAt,
            measuredAt: nowSec
        }
    }

    if (typeof entry.totalPercentUsed === 'number' && entry.totalPercentUsed >= 0 && entry.totalPercentUsed <= 1) {
        return {
            source: CURSOR_MONTHLY_SOURCE,
            usedPercent: clampPercent(entry.totalPercentUsed * 100),
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
