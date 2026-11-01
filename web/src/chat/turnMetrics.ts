import { isObject } from '@hapi/protocol'
import { estimateCodexCredits } from './codexCredits'
import type { NormalizedMessage, RoundSummary } from '@/chat/types'

export type TurnMetrics = { startedAt: number; durationMs?: number; tokens?: number; credits?: number }

function totalSnapshot(message: NormalizedMessage): { input: number; output: number; cached?: number } | undefined {
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
    const cached = total.cachedInputTokens ?? total.cached_input_tokens
    return { input: input as number, output: output as number,
        cached: Number.isSafeInteger(cached) && (cached as number) >= 0 ? cached as number : undefined }
}

function summaryTokens(summary: RoundSummary): number | undefined {
    if (summary.provider === 'codex' && summary.usage) {
        return summary.usage.input_tokens + summary.usage.output_tokens
    }
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
    let baseline: ReturnType<typeof totalSnapshot>
    for (let i = start - 1; i >= 0; i--) {
        baseline = totalSnapshot(messages[i])
        if (baseline !== undefined) break
        if (messages[i].role === 'user' && !messages[i].isSidechain && !messages[i].steered) break
    }
    let tokens: number | undefined
    let durationMs: number | undefined
    let credits: number | undefined
    let pricingModel: string | undefined
    let pricingTier: string | undefined
    let pricingTurn: string | undefined
    let pricingConsistent = true
    for (const message of messages.slice(start + 1)) {
        if (message.isSidechain || message.role !== 'event') continue
        if (message.content.type === 'turn-summary') {
            const summary = message.content.summary as RoundSummary
            tokens = summaryTokens(summary) ?? tokens
            durationMs = summary.durationMs ?? durationMs
        } else if (message.content.type === 'turn-duration' && typeof message.content.durationMs === 'number') {
            durationMs = message.content.durationMs
        } else if (message.content.type === 'token-count') {
            const total = totalSnapshot(message)
            if (baseline && total && total.input >= baseline.input && total.output >= baseline.output) {
                tokens = total.input - baseline.input + total.output - baseline.output
                const model = typeof message.content.model === 'string' ? message.content.model : undefined
                const tier = message.usage?.service_tier
                const turn = typeof message.content.turnId === 'string' ? message.content.turnId : undefined
                if (!model || !tier || !turn || (pricingModel && pricingModel !== model)
                    || (pricingTier && pricingTier !== tier) || (pricingTurn && pricingTurn !== turn)) pricingConsistent = false
                pricingModel = model ?? pricingModel
                pricingTier = tier ?? pricingTier
                pricingTurn = turn ?? pricingTurn
                if (pricingConsistent && pricingModel && pricingTier && total.cached !== undefined && baseline.cached !== undefined
                    && total.cached >= baseline.cached) {
                    credits = estimateCodexCredits(pricingModel, pricingTier, total.input - baseline.input,
                        total.cached - baseline.cached, total.output - baseline.output)
                } else credits = undefined
            }
        }
    }
    return { startedAt, durationMs, tokens, ...(credits !== undefined ? { credits } : {}) }
}
