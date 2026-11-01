import { describe, expect, it } from 'vitest'
import type { NormalizedMessage } from './types'
import { getTurnMetrics } from './turnMetrics'

const base = { localId: null, isSidechain: false }
const user = (createdAt: number): NormalizedMessage => ({ ...base, id: `u${createdAt}`, createdAt, role: 'user', content: { type: 'text', text: 'Hello' } })
const snapshot = (createdAt: number, input: number, output: number): NormalizedMessage => ({
    ...base, id: `e${createdAt}`, createdAt, role: 'event', content: {
        type: 'token-count', provider: 'codex', info: { total_token_usage: { input_tokens: input, output_tokens: output } }
    }
})

describe('turn metrics', () => {
    it('subtracts the previous cumulative snapshot and ignores steering messages', () => {
        const metrics = getTurnMetrics([user(100), snapshot(101, 1000, 100), user(200),
            { ...user(201), steered: true }, snapshot(202, 1500, 150), snapshot(203, 1700, 180)])
        expect(metrics).toEqual({ startedAt: 200, tokens: 780, durationMs: undefined })
    })

    it('does not mistake session totals for turn usage when history lacks a baseline', () => {
        expect(getTurnMetrics([user(100), snapshot(101, 1000, 100)])?.tokens).toBeUndefined()
    })

    it('keeps token and duration metrics when later events omit one of them', () => {
        const duration: NormalizedMessage = { ...base, id: 'duration', createdAt: 202, role: 'event',
            content: { type: 'turn-duration', durationMs: 3000 } }
        const summary: NormalizedMessage = { ...base, id: 'summary', createdAt: 203, role: 'event',
            content: { type: 'turn-summary', summary: { modelUsage: {} } } }
        expect(getTurnMetrics([user(100), snapshot(101, 1000, 100), user(200),
            snapshot(201, 1500, 150), duration, summary])).toEqual({ startedAt: 200, durationMs: 3000, tokens: 550 })
    })

    it('does not count cached Codex input twice in a summary', () => {
        const result: NormalizedMessage = { ...base, id: 'codex-result', createdAt: 200, role: 'event', content: {
            type: 'turn-summary', summary: { provider: 'codex', modelUsage: {},
                usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 90 } }
        } }
        expect(getTurnMetrics([user(100), result])?.tokens).toBe(120)
    })

    it('uses completed Claude round totals including cached input', () => {
        const result: NormalizedMessage = { ...base, id: 'result', createdAt: 200, role: 'event', content: {
            type: 'turn-summary', summary: { modelUsage: {}, durationMs: 10_000,
                usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 500 } }
        } }
        expect(getTurnMetrics([user(100), result])).toEqual({ startedAt: 100, durationMs: 10_000, tokens: 620 })
    })
})
