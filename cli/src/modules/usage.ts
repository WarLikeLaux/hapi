import { z } from 'zod'
import type { UsageSummaryResponse } from '@hapi/protocol/apiTypes'
import { connectPeerHub, resolveSessionByPrefix, type PingPeerSessionSummary } from './pingPeer/pingPeer'

export const USAGE_DESCRIPTION = 'Read actual session token usage collected by HAPI, equivalent to hapi get usage --json. Hub owner (default namespace) only; never subscription quota or remaining limits. Optional sessionIdPrefix filters one session without resuming it. Defaults: last 7 days, UTC. Missing provider usage is not estimated; no prices or costs are calculated.'

export const usageSchema = z.object({
    range: z.enum(['7d', '30d', 'all']).optional().describe('Rolling usage window, default 7d'),
    sessionIdPrefix: z.string().trim().min(1).optional().describe('Session ID or unique prefix; omit for the namespace summary'),
    timeZone: z.string().min(1).max(100).refine(value => {
        try { new Intl.DateTimeFormat('en-US', { timeZone: value }); return true } catch { return false }
    }, 'Invalid IANA time zone').optional().describe('IANA time zone for daily buckets, default UTC'),
})

export type UsageArgs = z.infer<typeof usageSchema>
export type UsageReport = UsageSummaryResponse & { sessionId: string | null }

export async function getUsage(input: UsageArgs = {}): Promise<UsageReport> {
    const args = usageSchema.parse(input)
    const hub = await connectPeerHub()
    const query = new URLSearchParams({ range: args.range ?? '7d', timeZone: args.timeZone ?? 'UTC' })
    let sessionId: string | null = null
    if (args.sessionIdPrefix) {
        const { sessions } = await hub.get<{ sessions: PingPeerSessionSummary[] }>('/sessions')
        sessionId = resolveSessionByPrefix(sessions, args.sessionIdPrefix).id
        query.set('sessionId', sessionId)
    }
    return { ...await hub.get<UsageSummaryResponse>(`/usage/summary?${query}`), sessionId }
}

export function formatUsageReport(report: UsageReport): string {
    const { totals } = report
    const rows = [
        'HAPI collected session usage (tokens; not subscription quota)',
        `Scope: ${report.sessionId ?? 'namespace summary'}`,
        `Period: ${report.range.from === null ? 'all history' : new Date(report.range.from).toISOString()} to ${report.range.to === null ? 'unknown' : new Date(report.range.to).toISOString()}`,
        `Sessions with recorded usage: ${totals.sessions}; recorded requests: ${totals.requests}`,
        `Tokens: ${totals.totalTokens} total; ${totals.inputTokens} input; ${totals.outputTokens} output`,
        `Input cache: ${totals.cacheReadTokens} read; ${totals.cacheCreationTokens} created (included in input)`,
        `Uncached tokens (input excluding cache reads + output): ${totals.uncachedTokens}`,
    ]
    for (const [label, buckets] of [['Agent', report.byAgent], ['Model', report.byModel]] as const) {
        for (const bucket of buckets.slice(0, 10)) rows.push(`${label} ${bucket.key}: ${bucket.totalTokens} tokens; ${bucket.requests} recorded requests`)
        if (buckets.length > 10) rows.push(`${label}: ${buckets.length - 10} more entries; use --json for the full breakdown`)
    }
    rows.push('Only collected usage is shown; missing usage is not estimated. Costs and subscription limits are unavailable here.')
    return rows.join('\n')
}
