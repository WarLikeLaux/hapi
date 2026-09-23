import type { QuotaWindow } from '@hapi/protocol/quotas'
import { clampPercent, errorMessage, type CollectorResult } from '../types'

export const ZAI_SOURCE = 'zai:5h'
const ZAI_QUOTA_URL = 'https://api.z.ai/api/monitor/usage/quota/limit'
const ZAI_TIMEOUT_MS = 20_000

export function configuredZaiApiKey(env: NodeJS.ProcessEnv = process.env): string | null {
    const direct = env.ZAI_API_KEY?.trim()
    if (direct) return direct
    // The claude flavor logs into z.ai through the Anthropic-compatible
    // endpoint (zcode-style env); its token doubles as the Z.AI account key,
    // so the runner picks it up without a second copy of the secret.
    const baseUrl = env.ANTHROPIC_BASE_URL?.trim()
    if (!baseUrl) return null
    let host: string
    try {
        host = new URL(baseUrl).hostname
    } catch {
        return null
    }
    if (host !== 'z.ai' && !host.endsWith('.z.ai')) return null
    return env.ANTHROPIC_AUTH_TOKEN?.trim() || env.ANTHROPIC_API_KEY?.trim() || null
}

/**
 * Z.AI Coding Plan quota response: `{ data: { limits: [...] } }` (some shapes
 * return the `{ limits: [...] }` object directly). The 5-hour token window is
 * the entry whose `type` is `TOKENS_LIMIT`; `percentage` is spent percent and
 * `nextResetTime` is unix milliseconds.
 */
export function parseZaiQuotaResponse(payload: unknown, nowSec: number): QuotaWindow | null {
    if (typeof payload !== 'object' || payload === null) return null
    const data = (payload as Record<string, unknown>).data
    const container = (typeof data === 'object' && data !== null ? data : payload) as Record<string, unknown>
    const limits = container.limits
    if (!Array.isArray(limits)) return null

    for (const limit of limits) {
        if (typeof limit !== 'object' || limit === null) continue
        const entry = limit as Record<string, unknown>
        if (entry.type !== 'TOKENS_LIMIT') continue
        if (typeof entry.percentage !== 'number') return null
        const resetsAt = typeof entry.nextResetTime === 'number'
            ? Math.floor(entry.nextResetTime / 1000)
            : null
        return {
            source: ZAI_SOURCE,
            usedPercent: clampPercent(entry.percentage),
            resetsAt,
            measuredAt: nowSec
        }
    }
    return null
}

export async function collectZaiQuota(nowSec: number, env: NodeJS.ProcessEnv = process.env): Promise<CollectorResult> {
    const apiKey = configuredZaiApiKey(env)
    if (!apiKey) return { kind: 'skipped' }

    try {
        // The quota endpoint expects the raw key in Authorization, without a Bearer prefix.
        const response = await fetch(ZAI_QUOTA_URL, {
            headers: {
                Authorization: apiKey,
                'Accept-Language': 'en-US,en',
                'Content-Type': 'application/json'
            },
            signal: AbortSignal.timeout(ZAI_TIMEOUT_MS)
        })
        if (!response.ok) {
            return {
                kind: 'unavailable',
                source: ZAI_SOURCE,
                reason: response.status === 401 ? 'auth_expired' : 'unavailable',
                detail: `HTTP ${response.status}`
            }
        }
        const payload = await response.json()
        const quotaWindow = parseZaiQuotaResponse(payload, nowSec)
        if (!quotaWindow) {
            return { kind: 'unavailable', source: ZAI_SOURCE, reason: 'unavailable', detail: 'TOKENS_LIMIT entry not found' }
        }
        return { kind: 'ok', windows: [quotaWindow] }
    } catch (error) {
        return { kind: 'unavailable', source: ZAI_SOURCE, reason: 'unavailable', detail: errorMessage(error) }
    }
}
