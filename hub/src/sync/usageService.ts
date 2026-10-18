import { isKnownFlavor, normalizeUsageModelId } from '@hapi/protocol'
import type { PopularModelsResponse, UsageSummaryBucket, UsageSummaryResponse } from '@hapi/protocol/apiTypes'
import type { StoredSession } from '../store'
import type { UsageEvent } from '../store/usage'
import type { Store } from '../store'

import { parseUsageEvent } from '../store/usageEvent'

function sessionModel(session: StoredSession): string | null {
    return typeof session.model === 'string' && session.model.trim() ? session.model.trim() : null
}

/** Shared by synchronous dashboard reads and the yielding legacy backfill. */
export function* collectUsageEventBatches(store: Store, sessions: StoredSession[]): Generator<void> {
    const scanStates = store.usage.getScanStates(sessions.map(session => session.id))
    for (const session of sessions) {
        const messageEpoch = store.messages.getMessageEpoch(session.id)
        const scanState = scanStates.get(session.id)
        let replaceEvents = !scanState || scanState.messageEpoch !== messageEpoch
        let afterSeq = replaceEvents ? 0 : (scanState?.lastSeq ?? 0)
        // Keep previously attributed models across a rebuild, including pages
        // whose original model differs from the session's current selection.
        let indexedModels: Map<string, string> | null = replaceEvents ? new Map(
            store.usage.getEvents([session.id]).filter(event => event.model !== null)
                .map(event => [event.sourceKey, event.model!])
        ) : null
        const getIndexedModel = (sourceKey: string): string | null => {
            // Live messages may arrive with a new model between backfill pages.
            const current = store.usage.getEventModel(session.id, sourceKey)
            if (current !== null) return current
            indexedModels ??= new Map(store.usage.getEvents([session.id])
                .filter(event => event.model !== null).map(event => [event.sourceKey, event.model!]))
            return indexedModels.get(sourceKey) ?? null
        }
        const fallbackModel = sessionModel(session)
        while (store.messages.getMessageEpoch(session.id) === messageEpoch) {
            const messages = store.messages.getMessagesAfterSeq(session.id, afterSeq, 200)
            const events = new Map<string, UsageEvent>()
            for (const message of messages) {
                const event = parseUsageEvent(session, message)
                if (!event) continue
                const existingEvent = events.get(event.sourceKey)
                const explicitModel = event.model
                event.model = explicitModel ?? existingEvent?.model ?? getIndexedModel(event.sourceKey) ?? fallbackModel
                if (event.kind === 'delta' || !existingEvent) events.set(event.sourceKey, event)
                else if (explicitModel !== null) existingEvent.model = explicitModel
            }
            const lastSeq = messages.at(-1)?.seq ?? afterSeq
            if (messages.length > 0 || replaceEvents) {
                store.usage.recordScan(session.id, messageEpoch, lastSeq, Array.from(events.values()), replaceEvents)
                for (const event of events.values()) {
                    if (event.model !== null) indexedModels?.set(event.sourceKey, event.model)
                }
            }
            if (messages.length < 200) break
            afterSeq = lastSeq
            replaceEvents = false
            yield
        }
    }
}

function collectUsageEvents(store: Store, sessions: StoredSession[]): void {
    for (const _batch of collectUsageEventBatches(store, sessions)) { /* Drain synchronously for the dashboard. */ }
}

type Totals = Omit<UsageSummaryBucket, 'key'>

function emptyTotals(): Totals {
    return {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        totalTokens: 0,
        uncachedTokens: 0,
        requests: 0
    }
}

function addTotals(target: Totals, inputTokens: number, outputTokens: number, cacheReadTokens: number, cacheCreationTokens: number): void {
    target.inputTokens += inputTokens
    target.outputTokens += outputTokens
    target.cacheReadTokens += cacheReadTokens
    target.cacheCreationTokens += cacheCreationTokens
    // Codex/Kimi inputTokens already includes cached input. Claude's raw
    // input_tokens excludes cache fields and is normalized before this call.
    target.totalTokens += inputTokens + outputTokens
    target.uncachedTokens += Math.max(0, inputTokens - cacheReadTokens) + outputTokens
    target.requests += 1
}

type UsageSnapshot = [number, number, number, number]

function cumulativeSnapshotDelta(
    current: UsageSnapshot,
    previous: UsageSnapshot | null,
    last: UsageSnapshot | null
): UsageSnapshot {
    // A provider reset applies to the entire snapshot. Mixing a `last` value
    // for one regressed counter with deltas from the old baseline for the other
    // counters invents a request that never existed.
    const reset = previous === null || current.some((value, index) => value < previous[index])
    if (reset) return last ?? current
    return current.map((value, index) => value - previous[index]) as UsageSnapshot
}

function toBucket(key: string, totals: Totals): UsageSummaryBucket {
    return { key, ...totals }
}

function createDayFormatter(timeZone: string): Intl.DateTimeFormat {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone,
        calendar: 'iso8601',
        numberingSystem: 'latn',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    })
}

function dayKey(timestamp: number, formatter: Intl.DateTimeFormat): string {
    const parts = formatter.formatToParts(new Date(timestamp))
    const year = parts.find((part) => part.type === 'year')?.value
    const month = parts.find((part) => part.type === 'month')?.value
    const day = parts.find((part) => part.type === 'day')?.value
    if (!year || !month || !day) throw new Error('Failed to format usage day')
    return `${year}-${month}-${day}`
}

export function getUsageSummary(
    store: Store,
    namespace: string,
    range: string | undefined,
    timeZone: string = 'UTC'
): UsageSummaryResponse {
    const sessions = store.sessions.getSessionsByNamespace(namespace)
    // This is intentionally lazy. Existing HAPI databases have no usage table;
    // the first dashboard request backfills history, while later requests only
    // update the idempotent event rows.
    collectUsageEvents(store, sessions)

    const now = Date.now()
    const days = range === '30d' ? 30 : range === 'all' ? null : 7
    const from = days === null ? null : now - days * 24 * 60 * 60 * 1000
    const sessionIds = new Set(sessions.map((session) => session.id))
    const events = store.usage.getEvents(Array.from(sessionIds))
    const isInRange = (event: UsageEvent) => (from === null || event.createdAt >= from) && event.createdAt <= now

    const totals = emptyTotals()
    const daily = new Map<string, Totals>()
    const byAgent = new Map<string, Totals>()
    const byModel = new Map<string, Totals>()
    const sessionsWithUsage = new Set<string>()
    const cumulativePrevious = new Map<string, UsageSnapshot>()
    const cumulativeFingerprints = new Set<string>()
    const dayFormatter = createDayFormatter(timeZone)

    for (const event of events) {
        let inputTokens = event.inputTokens
        let outputTokens = event.outputTokens
        let cacheReadTokens = event.cacheReadTokens
        let cacheCreationTokens = event.cacheCreationTokens
        let duplicateCumulativeEvent = false
        if (event.kind === 'cumulative') {
            const sourceParts = event.sourceKey.split('|')
            const streamKey = sourceParts.slice(0, 3).join('|')
            const previous = cumulativePrevious.get(streamKey) ?? null
            const current: UsageSnapshot = [
                event.inputTokens,
                event.outputTokens,
                event.cacheReadTokens,
                event.cacheCreationTokens
            ]
            const last: UsageSnapshot | null = event.lastInputTokens !== null
                && event.lastOutputTokens !== null
                && event.lastCacheReadTokens !== null
                && event.lastCacheCreationTokens !== null
                ? [
                    event.lastInputTokens,
                    event.lastOutputTokens,
                    event.lastCacheReadTokens,
                    event.lastCacheCreationTokens
                ]
                : null
            const delta = cumulativeSnapshotDelta(current, previous, last)
            inputTokens = delta[0]
            outputTokens = delta[1]
            cacheReadTokens = delta[2]
            cacheCreationTokens = delta[3]
            cumulativePrevious.set(streamKey, current)
            const turnId = sourceParts[3]
            if (turnId) {
                const fingerprint = [
                    event.sessionId,
                    turnId,
                    event.inputTokens,
                    event.outputTokens,
                    event.cacheReadTokens,
                    event.cacheCreationTokens,
                    event.lastInputTokens,
                    event.lastOutputTokens,
                    event.lastCacheReadTokens,
                    event.lastCacheCreationTokens
                ].join('|')
                duplicateCumulativeEvent = cumulativeFingerprints.has(fingerprint)
                cumulativeFingerprints.add(fingerprint)
            }
        }
        if (duplicateCumulativeEvent || !isInRange(event) || inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens <= 0) continue
        // Cache reads and writes partition processed input. Preserve the
        // request and its primary token counts when a provider emits an
        // impossible partition, but conservatively decline to credit either
        // cache bucket because their split is not trustworthy.
        if (cacheReadTokens + cacheCreationTokens > inputTokens) {
            cacheReadTokens = 0
            cacheCreationTokens = 0
        }
        addTotals(totals, inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens)
        const eventDayKey = dayKey(event.createdAt, dayFormatter)
        const dailyTotals = daily.get(eventDayKey) ?? emptyTotals()
        addTotals(dailyTotals, inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens)
        daily.set(eventDayKey, dailyTotals)
        const agentTotals = byAgent.get(event.agent) ?? emptyTotals()
        addTotals(agentTotals, inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens)
        byAgent.set(event.agent, agentTotals)
        const modelKey = event.model ?? 'unknown'
        const modelTotals = byModel.get(modelKey) ?? emptyTotals()
        addTotals(modelTotals, inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens)
        byModel.set(modelKey, modelTotals)
        sessionsWithUsage.add(event.sessionId)
    }

    const sortBuckets = (values: Map<string, Totals>): UsageSummaryBucket[] => Array.from(values.entries())
        .map(([key, value]) => toBucket(key, value))
        .sort((a, b) => b.totalTokens - a.totalTokens)

    return {
        range: { from, to: now },
        totals: { ...totals, sessions: sessionsWithUsage.size },
        daily: Array.from(daily.entries())
            .map(([key, value]) => toBucket(key, value))
            .sort((a, b) => a.key.localeCompare(b.key)),
        byAgent: sortBuckets(byAgent),
        byModel: sortBuckets(byModel),
        updatedAt: now
    }
}

/** Only reads the compact usage index, never the transcript blobs. */
export function getPopularModels(store: Pick<Store, 'usage'>, namespace: string): PopularModelsResponse {
    const to = Date.now()
    const from = to - 7 * 24 * 60 * 60 * 1000
    const pairs = new Map<string, PopularModelsResponse['models'][number] & { sessions: Set<string> }>()
    for (const event of store.usage.getModelActivity(namespace, from, to)) {
        if (!isKnownFlavor(event.agent) || !event.model || event.model === 'auto' || event.model === 'unknown') continue
        const model = normalizeUsageModelId(event.agent, event.model)
        const key = JSON.stringify([event.agent, model.toLowerCase()])
        const pair = pairs.get(key) ?? { agent: event.agent, model, sessionCount: 0, lastUsedAt: 0, sessions: new Set<string>() }
        pair.sessions.add(event.sessionId)
        pair.lastUsedAt = Math.max(pair.lastUsedAt, event.lastUsedAt)
        pairs.set(key, pair)
    }
    return {
        range: { from, to },
        models: Array.from(pairs.values()).map(({ sessions, ...pair }) => ({ ...pair, sessionCount: sessions.size }))
            .sort((left, right) => right.sessionCount - left.sessionCount || right.lastUsedAt - left.lastUsedAt
                || left.agent.localeCompare(right.agent) || left.model.localeCompare(right.model)),
    }
}
