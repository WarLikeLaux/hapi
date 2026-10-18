import type { StoredMessage, StoredSession } from './types'
import type { UsageEvent } from './usage'

type RecordValue = Record<string, unknown>

function asRecord(value: unknown): RecordValue | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as RecordValue
        : null
}

function asCount(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0
        ? Math.floor(value)
        : null
}

function firstCount(record: RecordValue, ...keys: string[]): number {
    for (const key of keys) {
        const value = asCount(record[key])
        if (value !== null) return value
    }
    return 0
}

function normalizeInputTokens(
    data: RecordValue,
    inputTokens: number,
    cacheReadTokens: number,
    cacheCreationTokens: number,
    legacySemantics: 'includes-cache' | 'excludes-cache'
): number {
    // v1 generic usage messages make their input contract self-describing.
    // Unknown/missing metadata intentionally falls back to the historical
    // provider shape so already persisted transcripts remain readable.
    const declaredSemantics = data.usageSchema === 'hapi.usage.v1'
        && (data.inputTokenSemantics === 'includes-cache' || data.inputTokenSemantics === 'excludes-cache')
        ? data.inputTokenSemantics
        : null
    const semantics = declaredSemantics ?? legacySemantics
    return semantics === 'excludes-cache'
        ? inputTokens + cacheReadTokens + cacheCreationTokens
        : inputTokens
}

function sessionAgent(session: StoredSession): string {
    const metadata = asRecord(session.metadata)
    const flavor = metadata?.flavor
    return typeof flavor === 'string' && flavor.trim() ? flavor.trim() : 'unknown'
}

export function parseUsageEvent(session: StoredSession, message: StoredMessage): UsageEvent | null {
    const envelope = asRecord(message.content)
    if (envelope?.role !== 'agent') return null

    const payload = asRecord(envelope.content)
    if (!payload) return null
    const data = asRecord(payload.data)
    if (!data) return null

    // Claude stream-json/SDK messages. A stream emits several updates for one
    // assistant message, so the provider's message id is the stable upsert key.
    if (payload.type === 'output' && data.type === 'assistant') {
        const assistant = asRecord(data.message)
        const usage = asRecord(assistant?.usage)
        if (!usage) return null
        const inputTokens = firstCount(usage, 'input_tokens', 'inputTokens')
        const outputTokens = firstCount(usage, 'output_tokens', 'outputTokens')
        const cacheReadTokens = firstCount(usage, 'cache_read_input_tokens', 'cacheReadTokens', 'cachedInputTokens')
        const cacheCreationTokens = firstCount(usage, 'cache_creation_input_tokens', 'cacheCreationTokens', 'cacheWriteInputTokens')
        if (inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens <= 0) return null
        const providerId = typeof assistant?.id === 'string' ? assistant.id : message.id
        const model = typeof assistant?.model === 'string' && assistant.model.trim()
            ? assistant.model.trim()
            : null
        return {
            sessionId: session.id,
            sourceKey: `claude|${providerId}`,
            sourceSeq: message.seq,
            createdAt: message.createdAt,
            agent: 'claude',
            model,
            kind: 'delta',
            inputTokens: normalizeInputTokens(data, inputTokens, cacheReadTokens, cacheCreationTokens, 'excludes-cache'),
            outputTokens,
            cacheReadTokens,
            cacheCreationTokens,
            lastInputTokens: null,
            lastOutputTokens: null,
            lastCacheReadTokens: null,
            lastCacheCreationTokens: null
        }
    }

    // Codex forwards cumulative thread totals plus the most recent request.
    // ACP-compatible backends wrap per-request usage in `total`, so only Codex
    // should be diffed as a cumulative stream.
    if (data.type === 'token_count' || data.type === 'usage') {
        if (data.hapiUsageScope === 'imported-history') return null
        const info = asRecord(data.info) ?? data
        const agent = sessionAgent(session)
        const explicitThreadId = typeof data.threadId === 'string'
            ? data.threadId
            : typeof data.thread_id === 'string'
                ? data.thread_id
                : null
        const metadata = asRecord(session.metadata)
        const hasImportedCodexHistory = typeof metadata?.codexSourceSessionId === 'string'
            || metadata?.lifecycleState === 'imported'
        if (agent === 'codex' && explicitThreadId === null && hasImportedCodexHistory) {
            return null
        }
        const cumulativeTotal = agent === 'codex'
            ? asRecord(info.total)
                ?? asRecord(info.total_token_usage)
                ?? asRecord(info.totalTokenUsage)
            : null
        const last = asRecord(info.last)
            ?? asRecord(info.last_token_usage)
            ?? asRecord(info.lastTokenUsage)
            ?? (data.type === 'usage' ? info : null)
        const total = cumulativeTotal ?? (agent === 'codex' ? last : asRecord(info.total) ?? info)
        if (!total) return null
        const rawInputTokens = firstCount(total, 'inputTokens', 'input_tokens')
        const outputTokens = firstCount(total, 'outputTokens', 'output_tokens')
        const cacheReadTokens = firstCount(total, 'cachedInputTokens', 'cached_input_tokens', 'cacheReadTokens', 'cache_read_input_tokens')
        const cacheCreationTokens = firstCount(total, 'cacheWriteInputTokens', 'cache_write_input_tokens', 'cacheCreationTokens', 'cache_creation_input_tokens')
        if (rawInputTokens + outputTokens + cacheReadTokens + cacheCreationTokens <= 0) return null
        const threadId = explicitThreadId ?? session.id
        const scope = typeof data.scopeRole === 'string'
            ? data.scopeRole
            : typeof data.scope_role === 'string'
                ? data.scope_role
                : 'parent'
        const isCumulative = cumulativeTotal !== null
        const turnId = typeof data.turnId === 'string'
            ? data.turnId
            : typeof data.turn_id === 'string'
                ? data.turn_id
                : ''
        const model = typeof data.model === 'string' && data.model.trim()
            ? data.model.trim()
            : null
        // Codex/Kimi provider formats have always reported inclusive input.
        // Imported Pi usage is known-inclusive, and for generic ACP an own
        // `model` property is the only strong provenance for the unmarked
        // inclusive wire introduced with the usage dashboard. Older ambiguous
        // payloads are conservatively treated as cache-exclusive.
        const legacyInputSemantics = agent === 'codex'
            || agent === 'kimi'
            || (agent === 'pi' && message.localId?.startsWith('pi:'))
            || Object.prototype.hasOwnProperty.call(data, 'model')
            ? 'includes-cache'
            : 'excludes-cache'
        const inputTokens = normalizeInputTokens(
            data,
            rawInputTokens,
            cacheReadTokens,
            cacheCreationTokens,
            legacyInputSemantics
        )
        const lastOutputTokens = last ? firstCount(last, 'outputTokens', 'output_tokens') : null
        const lastCacheReadTokens = last
            ? firstCount(last, 'cachedInputTokens', 'cached_input_tokens', 'cacheReadTokens', 'cache_read_input_tokens')
            : null
        const lastCacheCreationTokens = last
            ? firstCount(last, 'cacheWriteInputTokens', 'cache_write_input_tokens', 'cacheCreationTokens', 'cache_creation_input_tokens')
            : null
        const lastInputTokens = last
            ? normalizeInputTokens(
                data,
                firstCount(last, 'inputTokens', 'input_tokens'),
                lastCacheReadTokens ?? 0,
                lastCacheCreationTokens ?? 0,
                legacyInputSemantics
            )
            : null
        return {
            sessionId: session.id,
            sourceKey: isCumulative
                ? [
                    'cumulative',
                    threadId,
                    scope,
                    turnId,
                    inputTokens,
                    outputTokens,
                    cacheReadTokens,
                    cacheCreationTokens
                ].join('|')
                : `delta|${message.id}`,
            sourceSeq: message.seq,
            createdAt: message.createdAt,
            agent,
            model,
            kind: isCumulative ? 'cumulative' : 'delta',
            inputTokens,
            outputTokens,
            cacheReadTokens,
            cacheCreationTokens,
            lastInputTokens,
            lastOutputTokens,
            lastCacheReadTokens,
            lastCacheCreationTokens
        }
    }

    return null
}
