import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { clampPercent, errorMessage, type CollectorResult } from '../types'

const OPENCODE_MONTHLY_SOURCE = 'opencode:monthly'
const OPENCODE_USAGE_URL = 'https://opencode.ai/zen/go/v1/usage'

/** OpenCode stores Go credentials in its XDG data directory alongside other providers. */
function readGoApiKey(env: NodeJS.ProcessEnv): string | null {
    try {
        const dataHome = env.XDG_DATA_HOME || join(homedir(), '.local', 'share')
        const auth = JSON.parse(readFileSync(join(dataHome, 'opencode', 'auth.json'), 'utf8'))
        const entry = auth?.['opencode-go']
        return entry?.type === 'api' && typeof entry.key === 'string' ? entry.key.trim() || null : null
    } catch {
        return null
    }
}

/** The monthly reset marks the usage period boundary, not subscription cancellation. */
export async function collectOpencodeQuota(
    nowSec: number,
    env: NodeJS.ProcessEnv = process.env,
    fetchImpl: typeof fetch = fetch
): Promise<CollectorResult> {
    const apiKey = readGoApiKey(env)
    if (!apiKey) return { kind: 'skipped' }

    try {
        const response = await fetchImpl(OPENCODE_USAGE_URL, {
            headers: {
                Authorization: `Bearer ${apiKey}`,
                Accept: 'application/json',
                'User-Agent': 'HAPI-quota-reporter/1.0'
            },
            signal: AbortSignal.timeout(20_000)
        })
        if (!response.ok) {
            return {
                kind: 'unavailable',
                source: OPENCODE_MONTHLY_SOURCE,
                reason: response.status === 401 ? 'auth_expired' : 'unavailable',
                detail: `HTTP ${response.status}`
            }
        }
        const payload = await response.json() as {
            usage?: { monthly?: { status?: unknown; percent?: unknown; resetsAt?: unknown } }
        } | null
        const monthly = payload?.usage?.monthly
        if (!monthly || !['ok', 'rate-limited'].includes(String(monthly.status))
            || typeof monthly.percent !== 'number' || !Number.isFinite(monthly.percent)) {
            return { kind: 'unavailable', source: OPENCODE_MONTHLY_SOURCE, reason: 'unavailable', detail: 'Monthly usage not reported' }
        }
        const resetMs = typeof monthly.resetsAt === 'string' ? Date.parse(monthly.resetsAt) : NaN
        return {
            kind: 'ok',
            windows: [{
                source: OPENCODE_MONTHLY_SOURCE,
                usedPercent: clampPercent(monthly.percent),
                resetsAt: Number.isFinite(resetMs) ? Math.floor(resetMs / 1000) : null,
                measuredAt: nowSec
            }]
        }
    } catch (error) {
        return { kind: 'unavailable', source: OPENCODE_MONTHLY_SOURCE, reason: 'unavailable', detail: errorMessage(error) }
    }
}
