import { useId, useState } from 'react'
import { formatDuration } from '@/chat/presentation'
import { formatCodexCredits } from '@/chat/codexCredits'
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

    const usage = getRoundUsage(summary)
    if (usage) {
        const input = usage.input_tokens
            + (usage.cache_creation_input_tokens ?? 0)
            + (usage.cache_read_input_tokens ?? 0)
        const total = input + usage.output_tokens
        parts.push(`Tokens: ${formatCompactTokenCount(total)}${total > 0 ? ` (${formatPercentage(usage.output_tokens / total * 100)}% out)` : ''}`)

        const economics: string[] = []
        const cached = usage.cache_read_input_tokens
        if (input > 0 && cached !== undefined && cached > 0) {
            economics.push(`Cached input: ${formatPercentage(cached / input * 100)}%`)
        }
        if (summary.totalCostUsd !== undefined && summary.totalCostUsd > 0) {
            economics.push(`Cost: ${formatUsd(summary.totalCostUsd)}`)
        }
        if (economics.length > 0) parts.push(economics.join(' · '))
    } else if (summary.totalCostUsd !== undefined && summary.totalCostUsd > 0) {
        parts.push(`Cost: ${formatUsd(summary.totalCostUsd)}`)
    }

    const generation = getGenerationRate(summary)
    if (generation) parts.push(`${generation.rate} tok/s`)

    return parts
}

function getGenerationRate({ generationMs, generationOutputTokens }: RoundSummary) {
    if (generationMs === undefined || !Number.isFinite(generationMs) || generationMs <= 0
        || !isTokenCount(generationOutputTokens) || generationOutputTokens === 0) return
    return { duration: generationMs, tokens: generationOutputTokens, rate: (generationOutputTokens * 1000 / generationMs).toFixed(1) }
}

function compactRoundLabels(summary: RoundSummary): string[] {
    const parts: string[] = []
    if (summary.durationMs !== undefined) parts.push(`Time: ${formatDuration(summary.durationMs)}`)
    if (summary.provider === 'codex') {
        const ttft = summary.timeToFirstTokenMs
        if (ttft !== undefined) parts.push(`TTFT: ${ttft > 0 && ttft < 50 ? '<0.1s' : `${(ttft / 1000).toFixed(1)}s`}`)
        const estimate = summary.purchasedCreditsEstimate
        if (!estimate) parts.push('Credits: —')
        else {
            const amount = formatCodexCredits(estimate.amount)
            const scope = estimate.scope === 'last-request' ? ' (last request)' : ''
            parts.push(`Credits: ${amount}${scope}`)
        }
    }
    const generation = getGenerationRate(summary)
    parts.push(generation ? `${summary.provider === 'opencode' ? '' : '≈'}${generation.rate} tok/s` : 'tok/s: —')
    return parts
}

type MetricRow = readonly [label: string, value: string]

function isTokenCount(count: number | undefined): count is number {
    return count !== undefined && Number.isSafeInteger(count) && count >= 0
}

function detailRows(summary: RoundSummary): { rows: MetricRow[]; note: string } {
    const rows: MetricRow[] = []
    const { provider, usage, agyUsage } = summary
    const isCodex = provider === 'codex'
    const isAgy = provider === 'agy'
    const addCount = (label: string, count: number | undefined) => {
        if (isTokenCount(count)) rows.push([label, count.toLocaleString('en-US')])
    }

    const tier = usage?.service_tier?.toLowerCase()
    const speed = tier === 'priority' ? 'Fast' : tier && tier.charAt(0).toUpperCase() + tier.slice(1)
    if (isCodex && speed) {
        rows.push(['Speed mode', speed])
        if (Object.keys(summary.modelUsage).some(model => /^gpt-6\.2-(sol|astra)$/i.test(model))) {
            if (speed === 'Ultrafast') rows.push(['Included usage', '6× Standard'])
            if (speed === 'Fast') rows.push(['Included usage', '2× Standard'])
        }
    }
    if (isCodex && isTokenCount(summary.timeToFirstTokenMs)) {
        rows.push(['TTFT (reported)', `${summary.timeToFirstTokenMs.toLocaleString('en-US')} ms`])
    }
    const generation = getGenerationRate(summary)
    if (generation) {
        const { duration, tokens } = generation
        rows.push([isCodex || isAgy ? 'Time minus tools and waits' : 'Provider response time', duration < 100 ? `${duration} ms` : formatDuration(duration)])
        addCount('Generated tokens counted', tokens)
    }

    const input = isAgy ? agyUsage?.input_tokens : usage?.input_tokens
    const output = isAgy ? agyUsage?.output_tokens : usage?.output_tokens
    const cached = isAgy ? agyUsage?.cache_read_tokens : usage?.cache_read_input_tokens
    const cacheWrite = isAgy ? agyUsage?.cache_write_tokens : usage?.cache_creation_input_tokens
    const reasoning = isAgy ? agyUsage?.thinking_tokens : usage?.reasoning_output_tokens
    const validReasoning = isTokenCount(reasoning) && (isAgy || (output !== undefined && reasoning <= output)) ? reasoning : undefined

    const scope = summary.usageScope === 'last-request' ? 'Last request'
        : summary.usageScope === 'session' ? 'Session total' : 'Turn'
    const total = isAgy ? agyUsage?.total_tokens
        : isTokenCount(input) && isTokenCount(output)
            ? input + output + (isCodex ? 0 : (cached ?? 0) + (cacheWrite ?? 0)) : undefined
    addCount(isAgy ? 'Reported token total' : `${scope} tokens`, total)
    addCount(isCodex ? 'Input (incl. cache)' : isAgy ? 'Reported input' : 'Uncached input', input)
    addCount('Cache read', cached !== undefined && (!isCodex || (isTokenCount(input) && cached <= input)) ? cached : undefined)
    addCount('Cache write', cacheWrite !== undefined && (!isCodex || (isTokenCount(input) && cacheWrite <= input)) ? cacheWrite : undefined)
    addCount(isAgy || validReasoning !== undefined ? 'Output excluding reasoning' : 'Output (incl. reasoning)',
        isAgy || output === undefined || validReasoning === undefined ? output : output - validReasoning)
    if (validReasoning !== undefined) addCount('Reasoning', validReasoning)
    else if (isTokenCount(output)) rows.push(['Reasoning', 'Unavailable'])

    if (isCodex) {
        return { rows, note: summary.purchasedCreditsEstimate
            ? 'Estimate at regular purchased-credit rates. See Codex Usage for actual charges and plan limits.'
            : 'See Codex Usage for actual charges and plan limits.' }
    }
    if (isAgy) {
        const totalExcludesReasoning = total !== undefined && (validReasoning ?? 0) > 0
            && input !== undefined && output !== undefined && cached !== undefined
            && total === input + output + cached + (cacheWrite ?? 0)
        return { rows, note: totalExcludesReasoning ? 'The provider reports reasoning outside its token total.' : '' }
    }

    const providers = new Set(Object.keys(summary.modelUsage).map(model => model.split('/')[0]))
    if (providers.size === 1) {
        if (providers.has('opencode-go')) {
            return { rows, note: 'OpenCode Go shows actual allowance usage in the Go console.' }
        }
        if (providers.has('qcode')) return { rows, note: 'See QCode Usage Statistics for billed usage and quota.' }
        if (providers.has('zai-coding-plan') || providers.has('zai')) {
            return { rows, note: providers.has('zai-coding-plan')
                ? 'See Z.ai Billing for Coding Plan credits and limits.'
                : 'See Z.ai Billing for actual charges.' }
        }
    }
    if (providers.size > 1) return { rows, note: 'Multiple providers. See each provider’s billing for actual charges.' }
    if (summary.totalCostUsd) rows.push(['OpenCode-reported cost', formatUsd(summary.totalCostUsd)])
    return { rows, note: '' }
}

export function buildMessageMetadataLabels({ durationMs, usage, roundSummary }: Omit<MessageMetadataProps, 'className'>): string[] {
    if (roundSummary?.provider) return compactRoundLabels(roundSummary)
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
    const [diagnosticsOpen, setDiagnosticsOpen] = useState(false)
    const diagnosticsId = useId()
    const parts = buildMessageMetadataLabels({ durationMs, usage, model, turnCount, roundSummary })
    if (parts.length === 0) return null
    if (roundSummary?.provider) {
        const { rows, note } = detailRows(roundSummary)
        return (
            <div data-message-metrics className={`flex max-w-[min(22rem,calc(100vw-3rem))] flex-col gap-1 text-xs leading-tight tabular-nums text-[var(--app-fg)] ${className || ''}`}>
                <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 flex-col gap-1">
                        {parts.map(part => <span key={part}>{part}</span>)}
                    </div>
                    {(rows.length > 0 || note) && (
                        <button
                            type="button"
                            title="Usage diagnostics"
                            aria-label="Usage diagnostics"
                            aria-expanded={diagnosticsOpen}
                            aria-controls={diagnosticsId}
                            onClick={() => setDiagnosticsOpen(open => !open)}
                            className="-mr-1 -mt-1 grid size-6 shrink-0 place-items-center rounded text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)] focus-visible:ring-2 focus-visible:ring-[var(--app-link)] aria-expanded:bg-[var(--app-subtle-bg)] aria-expanded:text-[var(--app-fg)]"
                        >
                            <svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor" className="size-4">
                                <circle cx="5" cy="12" r="2" />
                                <circle cx="12" cy="12" r="2" />
                                <circle cx="19" cy="12" r="2" />
                            </svg>
                        </button>
                    )}
                </div>
                {(rows.length > 0 || note) && (
                    <div id={diagnosticsId} hidden={!diagnosticsOpen} className="mt-1 w-[17rem] max-w-full border-t border-[var(--app-border)] pt-2">
                        <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1.5">
                            {rows.map(([label, value]) => (
                                <div key={label} className="contents">
                                    <dt>{label}</dt>
                                    <dd className="text-right font-medium">{value}</dd>
                                </div>
                            ))}
                        </dl>
                        {note && <p className={rows.length > 0 ? 'mt-2' : undefined}>{note}</p>}
                    </div>
                )}
            </div>
        )
    }

    return (
        <div className={`flex max-w-[min(22rem,calc(100vw-1rem))] flex-col gap-1 text-xs leading-tight text-[var(--app-fg)] ${className || ''}`}>
            {parts.map((part, i) => (
                <span key={i} className="break-words">{part}</span>
            ))}
        </div>
    )
}
