import { describe, expect, it } from 'vitest'
import { buildMessageMetadataLabels } from './MessageMetadata'

describe('buildMessageMetadataLabels', () => {
    it('omits the per-message model name', () => {
        const parts = buildMessageMetadataLabels({
            model: 'claude-sonnet-4-6',
            usage: { input_tokens: 3, output_tokens: 15, service_tier: 'standard' }
        })
        expect(parts.some(p => p.startsWith('Model:'))).toBe(false)
    })

    it('does not render service_tier as the model when model is missing', () => {
        const parts = buildMessageMetadataLabels({
            usage: { input_tokens: 3, output_tokens: 15, service_tier: 'priority' }
        })
        // service_tier value (e.g. "priority", "standard_only") must never be
        // surfaced as the model id.
        expect(parts).not.toContain('Model: priority')
        expect(parts.some(p => p.startsWith('Model:'))).toBe(false)
        expect(parts).toContain('Tier: priority')
    })

    it('omits both Model and Tier labels when service_tier is the default standard', () => {
        const parts = buildMessageMetadataLabels({
            usage: { input_tokens: 3, output_tokens: 15, service_tier: 'standard' }
        })
        expect(parts.some(p => p.startsWith('Model:'))).toBe(false)
        expect(parts.some(p => p.startsWith('Tier:'))).toBe(false)
    })

    it('shows a non-standard tier without a model name', () => {
        const parts = buildMessageMetadataLabels({
            model: 'claude-sonnet-4-6',
            usage: { input_tokens: 3, output_tokens: 15, service_tier: 'priority' }
        })
        expect(parts).toContain('Tier: priority')
    })

    it('returns an empty list when nothing is provided', () => {
        expect(buildMessageMetadataLabels({})).toEqual([])
    })

    it('renders the token total and input/output breakdown without billing claims', () => {
        const parts = buildMessageMetadataLabels({
            usage: { input_tokens: 100, output_tokens: 200 }
        })
        expect(parts).toContain('Tokens: 300 (66.7% out)')
        expect(parts.some(p => /\bbillable\b/.test(p))).toBe(false)
    })

    it('does not drop a Duration line when durationMs is exactly 0', () => {
        const parts = buildMessageMetadataLabels({ durationMs: 0 })
        expect(parts).toContain('Duration: 0.0s')
    })

    it('uses compact units for long legacy durations', () => {
        expect(buildMessageMetadataLabels({ durationMs: 60_000 })).toContain('Duration: 1m')
        expect(buildMessageMetadataLabels({ durationMs: 3_600_000 })).toContain('Duration: 1h')
    })

    // Proof of Invariance — single-turn inputs (turnCount omitted, or < 2)
    // must produce byte-identical output to the pre-aggregate footer so
    // existing single-turn cards do not regress visually.
    it('single-turn input is byte-identical with or without turnCount=1', () => {
        const base = {
            durationMs: 1234,
            model: 'claude-sonnet-4-6',
            usage: { input_tokens: 3, output_tokens: 19, service_tier: 'standard' }
        }
        const withoutTurn = buildMessageMetadataLabels(base)
        const withTurnOne = buildMessageMetadataLabels({ ...base, turnCount: 1 })
        expect(withTurnOne).toEqual(withoutTurn)
    })

    // Byte-for-byte lock on the pre-aggregate label set. PR #555 introduced
    // this exact shape; any regression to ordering, label strings, or token
    // formatting would surface visually in single-turn cards.
    it('pre-aggregate single-turn call produces the exact label sequence', () => {
        const parts = buildMessageMetadataLabels({
            durationMs: 1234,
            model: 'claude-sonnet-4-6',
            usage: { input_tokens: 3, output_tokens: 19, service_tier: 'standard' }
        })
        // The Invoke value depends on the runner's timezone, so match its
        // shape rather than a literal time string. The remaining labels are
        // timezone-independent and locked exactly.
        expect(parts).toEqual([
            'Duration: 1.2s',
            'Tokens: 22 (86.4% out)'
        ])
    })

    it('shows aggregated tokens without the turn count', () => {
        const parts = buildMessageMetadataLabels({
            model: 'claude-sonnet-4-6, claude-haiku-4-5-20251001',
            usage: { input_tokens: 100, output_tokens: 200, service_tier: 'standard' },
            turnCount: 3
        })
        expect(parts.some(p => p.startsWith('Models:'))).toBe(false)
        expect(parts.some(p => p.startsWith('Model:'))).toBe(false)
        expect(parts).toContain('Tokens: 300 (66.7% out)')
        expect(parts.some(p => p.includes('turns'))).toBe(false)
    })

    it('omits the model for an aggregated group', () => {
        const parts = buildMessageMetadataLabels({
            model: 'claude-sonnet-4-6',
            usage: { input_tokens: 10, output_tokens: 20, service_tier: 'standard' },
            turnCount: 2
        })
        expect(parts.some(p => p.startsWith('Model:'))).toBe(false)
        expect(parts.some(p => p.startsWith('Models:'))).toBe(false)
        expect(parts.some(p => p.includes('turns'))).toBe(false)
    })

    it('omits Duration on aggregated footers when durationMs is undefined', () => {
        const parts = buildMessageMetadataLabels({
            model: 'claude-sonnet-4-6, claude-haiku-4-5-20251001',
            usage: { input_tokens: 10, output_tokens: 20, service_tier: 'standard' },
            turnCount: 2
        })
        expect(parts.some(p => p.startsWith('Duration:'))).toBe(false)
    })

    it('renders the exact Claude round summary hierarchy', () => {
        const parts = buildMessageMetadataLabels({
            model: 'derived-model-that-must-not-win',
            usage: { input_tokens: 1, output_tokens: 1 },
            roundSummary: {
                modelUsage: {
                    'claude-opus-5': {
                        inputTokens: 80,
                        cacheCreationInputTokens: 20,
                        cacheReadInputTokens: 100_000,
                        outputTokens: 500
                    },
                    'claude-haiku-4-5': {}
                },
                totalCostUsd: 0.028029,
                numTurns: 9,
                durationMs: 8163
            }
        } as any)

        expect(parts).toEqual([
            'Time: 8.2s',
            'Tokens: 100.6k (0.5% out)',
            'Cached input: 99.9% · Cost: $0.028'
        ])
    })

    it('formats long round durations with minutes and hours', () => {
        const summary = (durationMs: number) => buildMessageMetadataLabels({
            roundSummary: {
                modelUsage: {},
                durationMs,
                numTurns: 1
            }
        })

        expect(summary(59_900)).toContain('Time: 59.9s')
        expect(summary(60_000)).toContain('Time: 1m')
        expect(summary(537_000)).toContain('Time: 8m 57s')
        expect(summary(3_661_000)).toContain('Time: 1h 1m 1s')
    })

    it('omits a round label when only a turn count is available', () => {
        expect(buildMessageMetadataLabels({
            roundSummary: {
                provider: 'codex',
                modelUsage: {
                    'gpt-5.4': { inputTokens: 100, outputTokens: 10 }
                },
                numTurns: 1
            }
        })).toEqual([
            'Tokens: 110 (9.1% out)'
        ])
    })

    it('keeps the existing formatter byte-identical when no result summary is present', () => {
        expect(buildMessageMetadataLabels({
            durationMs: 1234,
            model: 'claude-sonnet-4-6',
            usage: { input_tokens: 3, output_tokens: 19, service_tier: 'standard' }
        } as any)).toEqual([
            'Duration: 1.2s',
            'Tokens: 22 (86.4% out)'
        ])
    })

    it('uses the normalized valid model fields when other model counters are absent', () => {
        expect(buildMessageMetadataLabels({
            roundSummary: {
                modelUsage: {
                    'claude-opus-5': { outputTokens: 10 },
                    'claude-haiku-4-5': { inputTokens: 10, outputTokens: 4 },
                    'claude-empty-5': {}
                },
                totalCostUsd: 0.00002,
                durationMs: 12.5
            }
        })).toEqual([
            'Time: 0.0s',
            'Tokens: 24 (58.3% out)',
            'Cost: <$0.0001'
        ])
    })
})


describe('Codex cached input metadata', () => {
    const labels = (input: number, cached?: number) => buildMessageMetadataLabels({
        roundSummary: {
            provider: 'codex',
            usage: { input_tokens: input, output_tokens: 10, cache_read_input_tokens: cached },
            modelUsage: { 'gpt-5.4': { inputTokens: input, outputTokens: 10 } },
            numTurns: 1
        }
    })

    it('uses cache-inclusive input without adding cached tokens again', () => {
        expect(labels(100, 80)).toEqual([
            'Tokens: 110 (9.1% out)',
            'Cached input: 80%'
        ])
    })

    it('uses token totals rather than averaging cache percentages', () => {
        expect(buildMessageMetadataLabels({
            roundSummary: {
                provider: 'codex',
                modelUsage: {
                    'model-a': { inputTokens: 100, cacheReadInputTokens: 80, outputTokens: 5 },
                    'model-b': { inputTokens: 900, cacheReadInputTokens: 90, outputTokens: 5 }
                }
            }
        })).toContain('Cached input: 17%')
    })

    it('distinguishes missing cache usage from an explicit zero', () => {
        expect(labels(100).some(label => label.startsWith('Cached input:'))).toBe(false)
        expect(labels(100, 0)).toContain('Cached input: 0%')
        expect(labels(100, 100)).toContain('Cached input: 100%')
    })

    it.each([-1, NaN, Infinity, 1.5])('omits invalid Codex output counts (%s)', output => {
        expect(buildMessageMetadataLabels({ roundSummary: {
            provider: 'codex', modelUsage: {},
            usage: { input_tokens: 100, output_tokens: output, cache_read_input_tokens: 80 }
        } }).some(label => label.startsWith('Tokens:') || label.startsWith('Cached input:'))).toBe(false)
    })

    it.each([
        [0, 0], [-1, 0], [100, -1], [100, 101], [100, NaN],
        [100, Infinity], [Infinity, 80], [NaN, 80], [100.5, 80],
        [100, 1.5], [Number.MAX_SAFE_INTEGER + 1, 80]
    ])('omits an invalid cache ratio for input=%s cached=%s', (input, cached) => {
        expect(labels(input, cached).some(label => label.startsWith('Cached input:'))).toBe(false)
        expect(labels(input, cached).join(' ')).not.toMatch(/NaN|Infinity/)
    })
})

it('shows the rounded round credit estimate in message details', () => {
    expect(buildMessageMetadataLabels({ roundSummary: { provider: 'codex', modelUsage: {}, credits: 0.6991375 } }))
        .toContain('Credits: 70')
})

it('puts round and credits first without repeating the model', () => {
    expect(buildMessageMetadataLabels({ roundSummary: { provider: 'codex', modelUsage: { 'gpt-6.1-terra': {} },
        usage: { input_tokens: 100, output_tokens: 10, service_tier: 'fast' }, durationMs: 3000, credits: 0.6991375 } }))
        .toEqual(['Time: 3.0s', 'Credits: 70', 'Tokens: 110 (9.1% out)'])
})
