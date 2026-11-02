import { formatCodexCredits } from '@/chat/codexCredits'
import { formatDuration } from '@/chat/presentation'
import type { RoundModelUsage, RoundSummary, UsageData } from '@/chat/types'

export type MessageMetadataProps = {
    durationMs?: number
    usage?: UsageData
    model?: string | null
    /**
     * Distinct turn count for the surrounding response group. Single-turn
     * footers pass `undefined` (or any value < 2).
     */
    turnCount?: number
    roundSummary?: RoundSummary
    className?: string
}

function formatCompactTokenCount(value: number): string {
    if (value < 1_000) return Math.round(value).toLocaleString()
    const divisor = value >= 1_000_000 ? 1_000_000 : 1_000
    const suffix = divisor === 1_000_000 ? 'm' : 'k'
    return `${(Math.round((value / divisor) * 10) / 10).toString()}${suffix}`
}

function formatPercentage(value: number): string {
    return (Math.round(value * 10) / 10).toString()
}

function formatUsd(value: number): string {
    if (value < 0.0001) return '<$0.0001'
    return value >= 0.01 ? `$${value.toFixed(3)}` : `$${value.toFixed(4)}`
}

function getRoundUsage(summary: RoundSummary): UsageData | undefined {
    const entries = Object.values(summary.modelUsage)
    const hasModelToken = entries.some((usage: RoundModelUsage) => Object.values(usage).some(token => typeof token === 'number'))
    if (!hasModelToken) return summary.usage

    return entries.reduce<UsageData>((total, usage) => ({
        input_tokens: total.input_tokens + (usage.inputTokens ?? 0),
        output_tokens: total.output_tokens + (usage.outputTokens ?? 0),
        cache_creation_input_tokens: (total.cache_creation_input_tokens ?? 0) + (usage.cacheCreationInputTokens ?? 0),
        cache_read_input_tokens: total.cache_read_input_tokens === undefined && usage.cacheReadInputTokens === undefined
            ? undefined
            : (total.cache_read_input_tokens ?? 0) + (usage.cacheReadInputTokens ?? 0)
    }), { input_tokens: 0, output_tokens: 0 })
}

function buildRoundSummaryLabels(summary: RoundSummary): string[] {
    const parts: string[] = []
    if (summary.durationMs !== undefined && summary.durationMs >= 0) parts.push(`Time: ${formatDuration(summary.durationMs)}`)
    if (summary.credits !== undefined) parts.push(`Credits: ${formatCodexCredits(summary.credits * 100)}`)

    const isCodex = summary.provider === 'codex'
    const usage = isCodex && summary.usage ? summary.usage : getRoundUsage(summary)
    if (usage && (!isCodex || (Number.isSafeInteger(usage.input_tokens) && usage.input_tokens >= 0
        && Number.isSafeInteger(usage.output_tokens) && usage.output_tokens >= 0))) {
        // Codex input already includes cache hits; Claude reports them separately.
        const input = isCodex ? usage.input_tokens : usage.input_tokens
            + (usage.cache_creation_input_tokens ?? 0)
            + (usage.cache_read_input_tokens ?? 0)
        const total = input + usage.output_tokens
        parts.push(`${summary.usageScope === 'last-request' ? 'Last request tokens' : 'Tokens'}: ${formatCompactTokenCount(total)}${total > 0 ? ` (${formatPercentage(usage.output_tokens / total * 100)}% out)` : ''}`)

        const economics: string[] = []
        const cached = usage.cache_read_input_tokens
        const showCache = isCodex
            ? Number.isSafeInteger(input) && input > 0
                && cached !== undefined && Number.isSafeInteger(cached) && cached >= 0 && cached <= input
            : input > 0 && (cached ?? 0) > 0
        if (showCache) {
            economics.push(`Cached input: ${formatPercentage(((cached ?? 0) / input) * 100)}%`)
        }
        if (summary.totalCostUsd !== undefined && summary.totalCostUsd > 0) {
            economics.push(`Cost: ${formatUsd(summary.totalCostUsd)}`)
        }
        if (economics.length > 0) parts.push(economics.join(' · '))
    } else if (summary.totalCostUsd !== undefined && summary.totalCostUsd > 0) {
        parts.push(`Cost: ${formatUsd(summary.totalCostUsd)}`)
    }

    return parts
}

export function buildMessageMetadataLabels({ durationMs, usage, roundSummary }: Omit<MessageMetadataProps, 'className'>): string[] {
    if (roundSummary) return buildRoundSummaryLabels(roundSummary)
    const parts: string[] = []
    if (typeof durationMs === 'number' && durationMs >= 0) {
        parts.push(`Duration: ${formatDuration(durationMs)}`)
    }

    const tier = usage?.service_tier
    const isStandardTier = tier?.toLowerCase() === 'standard'
    if (tier && !isStandardTier) parts.push(`Tier: ${tier}`)

    if (usage) {
        const total = usage.input_tokens + usage.output_tokens
        parts.push(`Tokens: ${formatCompactTokenCount(total)}${total > 0 ? ` (${formatPercentage(usage.output_tokens / total * 100)}% out)` : ''}`)
    }

    return parts
}

export function MessageMetadata({ durationMs, usage, model, turnCount, roundSummary, className }: MessageMetadataProps) {
    const parts = buildMessageMetadataLabels({ durationMs, usage, model, turnCount, roundSummary })
    if (parts.length === 0) return null

    return (
        <div className={`flex max-w-[min(22rem,calc(100vw-1rem))] flex-col gap-1 text-xs leading-tight text-[var(--app-fg)] ${className || ''}`}>
            {parts.map((part, i) => (
                <span key={i} className="break-words">{part}</span>
            ))}
        </div>
    )
}
