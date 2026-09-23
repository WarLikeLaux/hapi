import { describe, expect, it } from 'vitest'
import { parseZaiQuotaResponse, configuredZaiApiKey, ZAI_SOURCE } from './zai'

const NOW_SEC = 1_700_000_000

describe('configuredZaiApiKey', () => {
    it('returns the trimmed key', () => {
        expect(configuredZaiApiKey({ ZAI_API_KEY: '  key-123  ' })).toBe('key-123')
    })

    it('falls back to the Anthropic-compatible claude env on a z.ai host', () => {
        expect(configuredZaiApiKey({ ANTHROPIC_BASE_URL: 'https://api.z.ai/api/anthropic', ANTHROPIC_AUTH_TOKEN: 'tok-1' })).toBe('tok-1')
        expect(configuredZaiApiKey({ ANTHROPIC_BASE_URL: 'https://api.z.ai/api/anthropic', ANTHROPIC_API_KEY: 'tok-2' })).toBe('tok-2')
        expect(configuredZaiApiKey({ ANTHROPIC_BASE_URL: 'https://z.ai/api/anthropic', ANTHROPIC_AUTH_TOKEN: 'tok-3' })).toBe('tok-3')
    })

    it('prefers ZAI_API_KEY over the claude fallback', () => {
        expect(configuredZaiApiKey({ ZAI_API_KEY: 'direct', ANTHROPIC_BASE_URL: 'https://api.z.ai', ANTHROPIC_AUTH_TOKEN: 'tok' })).toBe('direct')
    })

    it('ignores the claude fallback on other hosts or with a broken base URL', () => {
        expect(configuredZaiApiKey({ ANTHROPIC_BASE_URL: 'https://api.anthropic.com', ANTHROPIC_AUTH_TOKEN: 'tok' })).toBeNull()
        expect(configuredZaiApiKey({ ANTHROPIC_BASE_URL: 'not a url', ANTHROPIC_AUTH_TOKEN: 'tok' })).toBeNull()
        expect(configuredZaiApiKey({ ANTHROPIC_AUTH_TOKEN: 'tok' })).toBeNull()
    })

    it('returns null when unset or blank', () => {
        expect(configuredZaiApiKey({})).toBeNull()
        expect(configuredZaiApiKey({ ZAI_API_KEY: '   ' })).toBeNull()
    })
})

describe('parseZaiQuotaResponse', () => {
    it('parses the wrapped limits payload', () => {
        expect(parseZaiQuotaResponse({
            data: { limits: [{ type: 'TIMEOUT_LIMIT', percentage: 10 }, { type: 'TOKENS_LIMIT', percentage: 42.6, nextResetTime: NOW_SEC * 1000 + 500 }] }
        }, NOW_SEC)).toEqual({
            source: ZAI_SOURCE,
            usedPercent: 42.6,
            resetsAt: NOW_SEC,
            measuredAt: NOW_SEC
        })
    })

    it('parses the unwrapped limits payload', () => {
        expect(parseZaiQuotaResponse({ limits: [{ type: 'TOKENS_LIMIT', percentage: 0, nextResetTime: 123_456 }] }, NOW_SEC)?.resetsAt).toBe(123)
    })

    it('returns null on non-TOKENS_LIMIT entries only', () => {
        expect(parseZaiQuotaResponse({ data: { limits: [{ type: 'OTHER', percentage: 5 }] } }, NOW_SEC)).toBeNull()
    })

    it('tolerates a missing nextResetTime and clamps out-of-range percentages', () => {
        const quotaWindow = parseZaiQuotaResponse({ data: { limits: [{ type: 'TOKENS_LIMIT', percentage: 130 }] } }, NOW_SEC)
        expect(quotaWindow).toMatchObject({ usedPercent: 100, resetsAt: null })
    })

    it('returns null for malformed payloads', () => {
        expect(parseZaiQuotaResponse(null, NOW_SEC)).toBeNull()
        expect(parseZaiQuotaResponse('nope', NOW_SEC)).toBeNull()
        expect(parseZaiQuotaResponse({ data: {} }, NOW_SEC)).toBeNull()
        expect(parseZaiQuotaResponse({ data: { limits: [{ type: 'TOKENS_LIMIT' }] } }, NOW_SEC)).toBeNull()
    })
})
