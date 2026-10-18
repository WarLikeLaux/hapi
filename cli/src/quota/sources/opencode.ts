import { clampPercent, errorMessage, type CollectorResult } from '../types'
import { resolveOpencodeQuotaAuth } from './opencodeAuth'

const OPENCODE_MONTHLY_SOURCE = 'opencode:monthly'
const OPENCODE_USAGE_URL = 'https://opencode.ai/zen/go/v1/usage'

/** The monthly reset marks the usage period boundary, not subscription cancellation. */
export async function collectOpencodeQuota(
    nowSec: number,
    env: NodeJS.ProcessEnv = process.env,
    fetchImpl: typeof fetch = fetch
): Promise<CollectorResult> {
    try {
        const auth = await resolveOpencodeQuotaAuth(nowSec, env)
        if (!auth) return { kind: 'skipped' }
        if (auth.kind === 'unavailable') {
            return { ...auth, source: OPENCODE_MONTHLY_SOURCE, reason: 'unavailable' }
        }
        const response = await fetchImpl(OPENCODE_USAGE_URL, {
            headers: {
                Authorization: `Bearer ${auth.key}`,
                ...(auth.kind === 'console' ? { 'x-opencode-org-id': auth.orgId } : {}),
                Accept: 'application/json',
                'User-Agent': 'HAPI-quota-reporter/1.0'
            },
            signal: AbortSignal.timeout(20_000)
        })
        if (!response.ok) {
            // A 401 alone does not establish expiry. Go API keys have no
            // refresh token; only the service's explicit code warrants asking
            // the user to create a replacement key (a Console login won't renew it).
            const failure = auth.kind === 'api' && response.status === 401
                ? await response.json().catch(() => null) as { error?: { code?: unknown } } | null
                : null
            return {
                kind: 'unavailable',
                source: OPENCODE_MONTHLY_SOURCE,
                reason: failure?.error?.code === 'api_key_expired' ? 'auth_expired' : 'unavailable',
                detail: auth.kind === 'console' && response.status === 401 ? 'Console sign-in required' : `HTTP ${response.status}`
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
