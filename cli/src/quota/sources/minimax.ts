import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { QuotaWindow } from '@hapi/protocol/quotas'
import { clampPercent, errorMessage, type CollectorResult } from '../types'

export const MINIMAX_5H_SOURCE = 'minimax:5h'
export const MINIMAX_WEEKLY_SOURCE = 'minimax:weekly'

const MINIMAX_TIMEOUT_MS = 15_000
const MINIMAX_DEFAULT_REGION = 'en'

/**
 * Three consecutive 401s in a row are tolerated before the collector reports
 * the source as unavailable. mcode silently refreshes its access token on
 * disk via the stored refresh_token (`refreshCredential` in mcode's auth
 * store) — a single poll that catches the token between expiry and refresh
 * does not flip the UI to "Authentication expired". The first good response
 * resets the counter; the threshold is only hit when 401s really persist
 * (server outage or a revoked refresh_token).
 */
export const MAX_MINIMAX_AUTH_FAILURES = 3

interface MinimaxAuthCache {
    lastValidWindows: QuotaWindow[] | null
    consecutiveAuthFailures: number
}

const authCache: MinimaxAuthCache = {
    lastValidWindows: null,
    consecutiveAuthFailures: 0
}

/**
 * Test-only hook: clears the in-memory cache so isolated cases start fresh.
 * Production code never needs to call this — the cache lives for the lifetime
 * of the runner process and resets on every successful poll.
 */
export function resetMinimaxAuthCache(): void {
    authCache.lastValidWindows = null
    authCache.consecutiveAuthFailures = 0
}

/** Quota bases mirror mcode's own region table (prod only). */
const MINIMAX_BASE_URLS: Record<string, string> = {
    en: 'https://platform.minimax.io',
    cn: 'https://www.minimaxi.com'
}

/** Credential files the MiniMax Code CLI writes at login. */
export type MinimaxAuthPaths = {
    regionFile: string
    authFile: (region: string) => string
}

function defaultAuthPaths(): MinimaxAuthPaths {
    const home = homedir()
    return {
        regionFile: join(home, '.minimax', 'preferences', 'mcode-region.json'),
        authFile: (region: string) => join(home, '.minimax', 'auth', 'prod', region, 'mcode-public', 'auth.json')
    }
}

export function minimaxBaseUrl(region: string): string {
    return MINIMAX_BASE_URLS[region] ?? MINIMAX_BASE_URLS[MINIMAX_DEFAULT_REGION]!
}

function asNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null
}

type MinimaxCredentials = { region: string; accessToken: string }

/**
 * Reads the region (preferences/mcode-region.json → regions.prod, default
 * en) and the freshest stored OAuth access token. Returns null when mcode is
 * not logged in; the token never leaves the machine except to MiniMax.
 */
export function readMinimaxCredentials(paths: MinimaxAuthPaths = defaultAuthPaths()): MinimaxCredentials | null {
    let region = MINIMAX_DEFAULT_REGION
    try {
        const parsed = JSON.parse(readFileSync(paths.regionFile, 'utf-8')) as { regions?: { prod?: unknown } }
        const prod = parsed.regions?.prod
        if (typeof prod === 'string' && prod.trim()) region = prod.trim()
    } catch {
        // No region preference — the default applies.
    }
    try {
        const parsed = JSON.parse(readFileSync(paths.authFile(region), 'utf-8')) as {
            records?: Record<string, unknown>
        }
        let accessToken: string | null = null
        let bestExpiresAtMs = -1
        for (const record of Object.values(parsed.records ?? {})) {
            if (typeof record !== 'object' || record === null) continue
            const entry = record as { accessToken?: unknown; expiresAtMs?: unknown }
            if (typeof entry.accessToken !== 'string' || !entry.accessToken.trim()) continue
            const expiresAtMs = asNumber(entry.expiresAtMs) ?? 0
            if (expiresAtMs < bestExpiresAtMs) continue
            bestExpiresAtMs = expiresAtMs
            accessToken = entry.accessToken.trim()
        }
        return accessToken ? { region, accessToken } : null
    } catch {
        return null
    }
}

type MinimaxRemainsRow = Record<string, unknown>

function remainsStatus(row: MinimaxRemainsRow, kind: 'interval' | 'weekly'): number | null {
    const prefix = kind === 'interval' ? 'current_interval' : 'current_weekly'
    return asNumber(row[`${prefix}_status`])
}

/** Remaining percent, preferring the reported percent over the count ratio (mcode's fallback). */
function remainingPercent(row: MinimaxRemainsRow, kind: 'interval' | 'weekly'): number | null {
    const prefix = kind === 'interval' ? 'current_interval' : 'current_weekly'
    const reported = asNumber(row[`${prefix}_remaining_percent`])
    if (reported !== null) return clampPercent(reported)
    const total = asNumber(row[`${prefix}_total_count`])
    const usage = asNumber(row[`${prefix}_usage_count`])
    if (total !== null && total > 0 && usage !== null) return clampPercent((usage / total) * 100)
    return null
}

function windowResetSec(row: MinimaxRemainsRow, kind: 'interval' | 'weekly'): number | null {
    const raw = kind === 'interval' ? asNumber(row.end_time) : asNumber(row.weekly_end_time)
    return raw !== null && raw > 0 ? Math.floor(raw / 1000) : null
}

function buildWindow(source: string, row: MinimaxRemainsRow, kind: 'interval' | 'weekly', nowSec: number): QuotaWindow | null {
    const remaining = remainingPercent(row, kind)
    const unlimited = remainsStatus(row, kind) === 3
    if (remaining === null && !unlimited) return null
    return {
        source,
        // Status 3 (unlimited) reports no percent — an unburnt window reads best.
        usedPercent: remaining === null ? 0 : clampPercent(100 - remaining),
        resetsAt: windowResetSec(row, kind),
        measuredAt: nowSec
    }
}

/**
 * MiniMax coding-plan quota response (`/v1/api/openplatform/coding_plan/remains`):
 * `{ base_resp: { status_code }, model_remains: [...] }` where the `general`
 * row carries the 5-hour and weekly windows. Rows report remaining; QuotaWindow
 * reports spend, so the percent flips.
 */
export function parseMinimaxQuotaResponse(payload: unknown, nowSec: number): QuotaWindow[] | null {
    if (typeof payload !== 'object' || payload === null) return null
    const rows = (payload as { model_remains?: unknown }).model_remains
    if (!Array.isArray(rows)) return null
    const parsedRows = rows.filter((row): row is MinimaxRemainsRow => typeof row === 'object' && row !== null)
    const general = parsedRows.find((row) => row.model_name === 'general') ?? parsedRows[0]
    if (!general) return null

    const windows: QuotaWindow[] = []
    const fiveHour = buildWindow(MINIMAX_5H_SOURCE, general, 'interval', nowSec)
    if (fiveHour) windows.push(fiveHour)
    const weekly = buildWindow(MINIMAX_WEEKLY_SOURCE, general, 'weekly', nowSec)
    if (weekly) windows.push(weekly)
    return windows.length > 0 ? windows : null
}

/**
 * Collects MiniMax coding-plan windows. 401s are absorbed up to
 * {@link MAX_MINIMAX_AUTH_FAILURES} consecutive strikes by replaying the
 * last known good windows so the UI does not flash "Authentication expired"
 * while mcode silently refreshes its OAuth token; after the threshold the
 * collector surfaces `auth_expired` as before.
 */
export async function collectMinimaxQuotas(
    nowSec: number,
    paths: MinimaxAuthPaths = defaultAuthPaths(),
    fetchImpl: typeof fetch = fetch
): Promise<CollectorResult> {
    const credentials = readMinimaxCredentials(paths)
    if (!credentials) return { kind: 'skipped' }

    try {
        const response = await fetchImpl(`${minimaxBaseUrl(credentials.region)}/v1/api/openplatform/coding_plan/remains`, {
            headers: {
                Accept: 'application/json',
                Authorization: `Bearer ${credentials.accessToken}`
            },
            signal: AbortSignal.timeout(MINIMAX_TIMEOUT_MS)
        })
        if (response.status === 401) {
            authCache.consecutiveAuthFailures += 1
            if (
                authCache.consecutiveAuthFailures < MAX_MINIMAX_AUTH_FAILURES
                && authCache.lastValidWindows
            ) {
                // Replay the last good snapshot so the UI does not flash the
                // error while mcode's silent refresh lands. The original
                // measuredAt stays — the UI's staleness indicator tells the
                // user how old the numbers are.
                return { kind: 'ok', windows: authCache.lastValidWindows }
            }
            return {
                kind: 'unavailable',
                source: MINIMAX_5H_SOURCE,
                reason: 'auth_expired',
                detail: `HTTP 401 (${authCache.consecutiveAuthFailures} consecutive)`
            }
        }
        if (!response.ok) {
            // Non-401 transport errors do not count against the auth-failure
            // threshold; they keep whatever counter state was reached.
            return {
                kind: 'unavailable',
                source: MINIMAX_5H_SOURCE,
                reason: 'unavailable',
                detail: `HTTP ${response.status}`
            }
        }
        const payload: unknown = await response.json()
        const statusCode = asNumber(
            (payload as { base_resp?: { status_code?: unknown } } | null)?.base_resp?.status_code
        )
        if (statusCode !== null && statusCode !== 0) {
            return { kind: 'unavailable', source: MINIMAX_5H_SOURCE, reason: 'unavailable', detail: `status_code ${statusCode}` }
        }
        const windows = parseMinimaxQuotaResponse(payload, nowSec)
        if (!windows) {
            return { kind: 'unavailable', source: MINIMAX_5H_SOURCE, reason: 'unavailable', detail: 'model_remains not found' }
        }
        // A successful poll clears the auth-failure streak and stamps the
        // cached windows so the next 401 has something to replay.
        authCache.consecutiveAuthFailures = 0
        authCache.lastValidWindows = windows
        return { kind: 'ok', windows }
    } catch (error) {
        return { kind: 'unavailable', source: MINIMAX_5H_SOURCE, reason: 'unavailable', detail: errorMessage(error) }
    }
}
