import { isObject } from '@hapi/protocol'
import type { NormalizedMessage, RoundSummary } from '@/chat/types'

export type TurnMetrics = { startedAt: number; durationMs?: number; tokens?: number }

function totalSnapshot(message: NormalizedMessage): number | undefined {
    if (message.role !== 'event' || message.content.type !== 'token-count'
        || message.content.provider !== 'codex' || message.usage?.scope_role === 'child') return
    const info = message.content.info
    if (!isObject(info)) return
    const total = info.total ?? info.totalTokenUsage ?? info.total_token_usage
    if (!isObject(total)) return
    const input = total.inputTokens ?? total.input_tokens
    const output = total.outputTokens ?? total.output_tokens
    if (!Number.isSafeInteger(input) || !Number.isSafeInteger(output)
        || (input as number) < 0 || (output as number) < 0) return
    return (input as number) + (output as number)
}

function summaryTokens(summary: RoundSummary): number | undefined {
    const models = Object.values(summary.modelUsage)
    if (models.length && models.every(item => item.inputTokens !== undefined && item.outputTokens !== undefined)) {
        return models.reduce((sum, item) => sum + item.inputTokens! + item.outputTokens!
            + (item.cacheReadInputTokens ?? 0) + (item.cacheCreationInputTokens ?? 0), 0)
    }
    const usage = summary.usage
    return usage ? usage.input_tokens + usage.output_tokens + (usage.cache_read_input_tokens ?? 0)
        + (usage.cache_creation_input_tokens ?? 0) : undefined
}

/** Use only a complete turn summary or a pair of session cumulative snapshots. */
export function getTurnMetrics(messages: readonly NormalizedMessage[]): TurnMetrics | null {
    const start = messages.findLastIndex(message => message.role === 'user' && !message.isSidechain && !message.steered)
    if (start < 0) return null
    const startedAt = messages[start].invokedAt ?? messages[start].createdAt
    if (!Number.isFinite(startedAt) || startedAt <= 0) return null
    let baseline: number | undefined
    for (let i = start - 1; i >= 0; i--) {
        baseline = totalSnapshot(messages[i])
        if (baseline !== undefined) break
        if (messages[i].role === 'user' && !messages[i].isSidechain && !messages[i].steered) break
    }
    let tokens: number | undefined
    let durationMs: number | undefined
    for (const message of messages.slice(start + 1)) {
        if (message.isSidechain || message.role !== 'event') continue
        if (message.content.type === 'turn-summary') {
            const summary = message.content.summary as RoundSummary
            tokens = summaryTokens(summary)
            durationMs = summary.durationMs
        } else if (message.content.type === 'turn-duration' && typeof message.content.durationMs === 'number') {
            durationMs = message.content.durationMs
        } else if (message.content.type === 'token-count') {
            const total = totalSnapshot(message)
            if (baseline !== undefined && total !== undefined && total >= baseline) tokens = total - baseline
        }
    }
    return { startedAt, durationMs, tokens }
}
