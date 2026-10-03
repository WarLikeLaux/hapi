import { getReasoningStreamId } from '@hapi/protocol/messages'
import type { ApiClient } from '@/api/client'
import { normalizeDecryptedMessage } from '@/chat/normalize'
import type { DecryptedMessage, MessageStatus, MessagesResponse } from '@/types/api'
import { isQueuedForInvocation, mergeMessages } from '@/lib/messages'

export type MessageViewMode = 'tail' | 'history'

export type OlderLoadOutcome =
    | {
        kind: 'applied'
        historyVersion: number
        hasMore: boolean
        addedRenderableCount: number
    }
    | {
        kind: 'stopped'
        reason: 'unavailable' | 'busy' | 'invalidated' | 'epoch-reset' | 'exhausted'
    }
    | {
        kind: 'failed'
        error: Error
    }

export type MessageWindowState = {
    sessionId: string
    messages: DecryptedMessage[]
    hasMore: boolean
    oldestSeq: number | null
    newestSeq: number | null
    epoch: number | null
    isSyncingTail: boolean
    isLoadingMore: boolean
    warning: string | null
    viewMode: MessageViewMode
    messagesVersion: number
    historyVersion: number
    tailRevision: number
}

/**
 * Window budgets are counted in conversation units — the messages a user
 * actually sees (a user prompt, or the final assistant message of one agent
 * run) — not in raw stream records. A single agent turn can span hundreds of
 * records while collapsing into one visible message, so record-count windows
 * either thrashed (a "page" smaller than one screen) or evicted loaded
 * history the moment the user scrolled back to the tail.
 */
export const TAIL_UNIT_BUDGET = 120
export const HISTORY_UNIT_BUDGET = 240
/**
 * First paint of a cold window: the last two user prompts and the two agent
 * responses around them. Older history loads only on explicit upward swipes.
 */
const INITIAL_USER_UNITS = 2
const INITIAL_AGENT_UNITS = 2
/**
 * Upper bound for the cold-window backfill in page iterations. The loop exits
 * early as soon as `hasInitialConversationCoverage` is met (or history is
 * exhausted), so this only caps sessions where coverage can never be reached
 * — e.g. a session with a single user prompt. Set generously so cold-window
 * covers any plausible transcript; per-page work is bounded by PAGE_SIZE.
 */
const INITIAL_COVERAGE_MAX_PAGES = 256
const OLDER_LOAD_MAX_PAGES = 4
const AGENT_RUN_WINDOW_SIZE = 800
const PAGE_SIZE = 200

type MessagePosition = {
    at: number
    seq: number
}

type InternalState = MessageWindowState & {
    oldestPositionAt: number | null
    oldestPositionSeq: number | null
    newestPositionAt: number | null
    newestPositionSeq: number | null
    requiresLatestReset: boolean
    syncGeneration: number
    olderGeneration: number
}

type PersistedMessageWindowState = {
    messages: DecryptedMessage[]
    hasMore: boolean
    oldestPositionAt: number | null
    oldestPositionSeq: number | null
    newestPositionAt: number | null
    newestPositionSeq: number | null
    epoch: number | null
}

type TailSyncController = {
    api: ApiClient
    running: Promise<void> | null
    trailingRequested: boolean
}

const states = new Map<string, InternalState>()
// Keep each session's latest answer available even while its active window
// pages away from the tail. These snapshots share message objects with states.
const cachedTails = new Map<string, InternalState>()
const listeners = new Map<string, Set<() => void>>()
const tailSyncControllers = new Map<string, TailSyncController>()
const appliedRewindLocalIds = new Map<string, Set<string>>()

const NOTIFY_THROTTLE_MS = 150
const PERSIST_THROTTLE_MS = 200
const CACHE_UNIT_BUDGET = 4
const CACHE_CHARACTER_BUDGET = 256 * 1024
const messageCharacterSizes = new WeakMap<DecryptedMessage, number>()
// V3 cursors certify REST coverage. V2 could persist a live message past an unseen gap, so those snapshots must be fetched again rather than resumed.
const STORAGE_KEY_PREFIX = 'hapi:message-window:v3:'
const pendingNotifySessionIds = new Set<string>()
const pendingPersistSessionIds = new Set<string>()
const normalizedMessageCache = new WeakMap<DecryptedMessage, ReturnType<typeof normalizeDecryptedMessage>>()
let notifyRafId: ReturnType<typeof requestAnimationFrame> | null = null
let notifyTimerId: ReturnType<typeof setTimeout> | null = null
let persistTimerId: ReturnType<typeof setTimeout> | null = null
let lastNotifyAt = 0

function requestNotifyFrame(): void {
    if (notifyRafId !== null) {
        return
    }
    if (typeof requestAnimationFrame === 'function') {
        notifyRafId = requestAnimationFrame(flushNotifications)
        return
    }
    notifyRafId = setTimeout(flushNotifications, 0) as unknown as ReturnType<typeof requestAnimationFrame>
}

function scheduleNotify(sessionId: string): void {
    pendingNotifySessionIds.add(sessionId)
    if (notifyRafId !== null || notifyTimerId !== null) {
        return
    }
    const remaining = NOTIFY_THROTTLE_MS - (Date.now() - lastNotifyAt)
    if (remaining <= 0) {
        requestNotifyFrame()
        return
    }
    notifyTimerId = setTimeout(() => {
        notifyTimerId = null
        requestNotifyFrame()
    }, remaining)
}

function flushNotifications(): void {
    notifyRafId = null
    lastNotifyAt = Date.now()
    const sessionIds = [...pendingNotifySessionIds]
    pendingNotifySessionIds.clear()
    for (const sessionId of sessionIds) {
        const subscribers = listeners.get(sessionId)
        if (!subscribers) continue
        for (const listener of subscribers) {
            listener()
        }
    }
}

function getStorageKey(sessionId: string): string {
    return `${STORAGE_KEY_PREFIX}${sessionId}`
}

function isSessionStorageAvailable(): boolean {
    try {
        return typeof sessionStorage?.getItem === 'function'
    } catch {
        return false
    }
}

function toNullableNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function readPosition(at: unknown, seq: unknown): MessagePosition | null {
    const positionAt = toNullableNumber(at)
    const positionSeq = toNullableNumber(seq)
    return positionAt !== null && positionSeq !== null
        ? { at: positionAt, seq: positionSeq }
        : null
}

function shouldPersistState(state: InternalState): boolean {
    return state.messages.length > 0
        || state.hasMore
        || state.epoch !== null
        || state.oldestPositionAt !== null
        || state.newestPositionAt !== null
}

function persistState(sessionId: string, state: InternalState): void {
    if (!isSessionStorageAvailable()) {
        return
    }
    try {
        if (!shouldPersistState(state)) {
            sessionStorage.removeItem(getStorageKey(sessionId))
            return
        }
        const tail = cachedTails.get(sessionId)
        if (!tail) return
        const persisted: PersistedMessageWindowState = {
            messages: tail.messages,
            hasMore: tail.hasMore,
            oldestPositionAt: tail.oldestPositionAt,
            oldestPositionSeq: tail.oldestPositionSeq,
            newestPositionAt: tail.newestPositionAt,
            newestPositionSeq: tail.newestPositionSeq,
            epoch: tail.epoch
        }
        sessionStorage.setItem(getStorageKey(sessionId), JSON.stringify(persisted))
    } catch {
    }
}

function clearPersistedState(sessionId: string): void {
    cachedTails.delete(sessionId)
    pendingPersistSessionIds.delete(sessionId)
    if (!isSessionStorageAvailable()) {
        return
    }
    try {
        sessionStorage.removeItem(getStorageKey(sessionId))
    } catch {
    }
}

function flushPersistedStates(): void {
    if (persistTimerId !== null) clearTimeout(persistTimerId)
    persistTimerId = null
    const sessionIds = [...pendingPersistSessionIds]
    pendingPersistSessionIds.clear()
    for (const sessionId of sessionIds) {
        const state = states.get(sessionId)
        if (state) {
            persistState(sessionId, state)
            const tail = cachedTails.get(sessionId)
            if (tail && !listeners.has(sessionId) && !state.isSyncingTail && !state.isLoadingMore) {
                // Defer cleanup so React's temporary unsubscribe in StrictMode
                // cannot replace a mounted reader's history window.
                states.set(sessionId, restoreCachedTail(state, tail))
                if (!tailSyncControllers.get(sessionId)?.running) {
                    tailSyncControllers.delete(sessionId)
                }
            }
        } else {
            clearPersistedState(sessionId)
        }
    }
}

if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', flushPersistedStates)
}

function schedulePersist(sessionId: string): void {
    // In-memory cleanup still runs when browser storage is unavailable.
    pendingPersistSessionIds.add(sessionId)
    if (persistTimerId === null) {
        persistTimerId = setTimeout(flushPersistedStates, PERSIST_THROTTLE_MS)
    }
}

function createState(sessionId: string): InternalState {
    return {
        sessionId,
        messages: [],
        hasMore: false,
        oldestSeq: null,
        newestSeq: null,
        epoch: null,
        isSyncingTail: false,
        isLoadingMore: false,
        warning: null,
        viewMode: 'tail',
        messagesVersion: 0,
        historyVersion: 0,
        tailRevision: 0,
        oldestPositionAt: null,
        oldestPositionSeq: null,
        newestPositionAt: null,
        newestPositionSeq: null,
        requiresLatestReset: false,
        syncGeneration: 0,
        olderGeneration: 0
    }
}

function hydrateState(sessionId: string): InternalState | null {
    if (!isSessionStorageAvailable()) {
        return null
    }
    try {
        const raw = sessionStorage.getItem(getStorageKey(sessionId))
        if (!raw) {
            return null
        }
        const parsed = JSON.parse(raw) as Partial<PersistedMessageWindowState> | null
        if (!parsed || !Array.isArray(parsed.messages)) {
            clearPersistedState(sessionId)
            return null
        }
        const restoreMessage = (message: DecryptedMessage): DecryptedMessage => {
            if (message.status !== 'sending') {
                return message
            }
            return {
                ...message,
                status: message.invokedAt === null ? 'queued' : 'sent'
            }
        }
        const oldest = readPosition(parsed.oldestPositionAt, parsed.oldestPositionSeq)
        const newest = readPosition(parsed.newestPositionAt, parsed.newestPositionSeq)
        const epoch = typeof parsed.epoch === 'number' && Number.isInteger(parsed.epoch) && parsed.epoch >= 0
            ? parsed.epoch
            : null
        return buildState(createState(sessionId), {
            messages: mergeMessages([], parsed.messages.map(restoreMessage)),
            hasMore: parsed.hasMore === true,
            oldestPositionAt: oldest?.at ?? null,
            oldestPositionSeq: oldest?.seq ?? null,
            newestPositionAt: newest?.at ?? null,
            newestPositionSeq: newest?.seq ?? null,
            epoch,
            requiresLatestReset: parsed.messages.length > 0 && (newest === null || epoch === null)
        })
    } catch {
        clearPersistedState(sessionId)
        return null
    }
}

function getState(sessionId: string): InternalState {
    const existing = states.get(sessionId)
    if (existing) {
        return existing
    }
    const created = hydrateState(sessionId) ?? createState(sessionId)
    states.set(sessionId, created)
    if (shouldPersistState(created)) cachedTails.set(sessionId, compactCachedTail(created))
    return created
}

function notifyImmediate(sessionId: string): void {
    const subscribers = listeners.get(sessionId)
    if (!subscribers) return
    for (const listener of subscribers) {
        listener()
    }
}

function setState(sessionId: string, next: InternalState, immediate = false): void {
    const previous = states.get(sessionId)
    if (next.viewMode === 'tail' && !next.requiresLatestReset) {
        cachedTails.set(sessionId, compactCachedTail(next))
    } else if (previous?.viewMode === 'tail' && next.viewMode === 'history' && !previous.requiresLatestReset) {
        cachedTails.set(sessionId, compactCachedTail(previous))
    }
    const tail = cachedTails.get(sessionId)
    if (tail && previous && (next.viewMode === 'history' || next.requiresLatestReset) && next.messages !== previous.messages) {
        const currentById = new Map(next.messages.map(message => [message.id, message]))
        const currentByLocalId = new Map(next.messages.filter(message => message.localId).map(message => [message.localId, message]))
        const previousIds = new Set(previous.messages.map(message => message.id))
        const refreshed = tail.messages.flatMap(message => {
            const current = currentById.get(message.id) ?? (message.localId ? currentByLocalId.get(message.localId) : undefined)
            if (current) return [current]
            // Removing a queued/optimistic prompt must also remove it from the
            // warm snapshot. Paging ordinary history out is not a deletion.
            if (previousIds.has(message.id) && isQueuedForInvocation(message)) return []
            return [message]
        })
        cachedTails.set(sessionId, compactCachedTail(buildState(tail, {
            messages: mergeMessages(refreshed, next.messages.filter(isQueuedForInvocation))
        })))
    }
    states.set(sessionId, next)
    // A history window can lose its tail while paging. Persist only its warm
    // tail, never that incomplete history window. Structural invalidation
    // clears the warm snapshot so removed messages cannot be resurrected.
    if (next.requiresLatestReset && !cachedTails.has(sessionId)) {
        pendingPersistSessionIds.delete(sessionId)
    } else {
        schedulePersist(sessionId)
    }
    if (immediate) {
        notifyImmediate(sessionId)
    } else {
        scheduleNotify(sessionId)
    }
}

function cachedCharacterSize(messages: DecryptedMessage[]): number {
    let total = 0
    for (const message of messages) {
        let size = messageCharacterSizes.get(message)
        if (size === undefined) {
            size = JSON.stringify(message).length
            messageCharacterSizes.set(message, size)
        }
        total += size
    }
    return total
}

function compactCachedTail(previous: InternalState): InternalState {
    let { kept } = trimToUnitBudget(previous.messages, CACHE_UNIT_BUDGET, 'append')
    let partialCoverage = previous.requiresLatestReset
    if (cachedCharacterSize(kept) > CACHE_CHARACTER_BUDGET) {
        // The final text stays complete. Intermediate tool/stream records can
        // be restored asynchronously without delaying the cached first paint.
        const anchors = findConversationAnchorIds(kept)
        const compacted = kept.filter(message => anchors.has(message.id) || isQueuedForInvocation(message))
        partialCoverage ||= compacted.length !== kept.length
        kept = compacted
        for (let units = CACHE_UNIT_BUDGET - 1; units >= 2 && cachedCharacterSize(kept) > CACHE_CHARACTER_BUDGET; units--) {
            kept = trimToUnitBudget(kept, units, 'append').kept
        }
        // The latest prompt and complete answer may exceed the soft budget.
        // Prefer instant access to that answer over truncating its text.
    }
    const dropped = kept.length !== previous.messages.length
    const oldest = dropped ? derivePosition(kept, 'oldest') : readPosition(previous.oldestPositionAt, previous.oldestPositionSeq)
    return buildState(previous, {
        messages: kept,
        viewMode: 'tail',
        hasMore: previous.hasMore || dropped,
        isSyncingTail: false,
        isLoadingMore: false,
        oldestPositionAt: oldest?.at ?? null,
        oldestPositionSeq: oldest?.seq ?? null,
        newestPositionAt: partialCoverage ? null : previous.newestPositionAt,
        newestPositionSeq: partialCoverage ? null : previous.newestPositionSeq,
        requiresLatestReset: partialCoverage
    })
}

function restoreCachedTail(previous: InternalState, tail: InternalState): InternalState {
    return buildState(previous, {
        messages: mergeMessages(tail.messages, previous.messages.filter(isQueuedForInvocation)),
        viewMode: 'tail',
        hasMore: tail.hasMore,
        epoch: tail.epoch,
        oldestPositionAt: tail.oldestPositionAt,
        oldestPositionSeq: tail.oldestPositionSeq,
        newestPositionAt: tail.newestPositionAt,
        newestPositionSeq: tail.newestPositionSeq,
        requiresLatestReset: previous.requiresLatestReset || tail.requiresLatestReset
    })
}

function updateState(
    sessionId: string,
    updater: (previous: InternalState) => InternalState,
    immediate = false
): void {
    const previous = getState(sessionId)
    const next = updater(previous)
    if (next !== previous) {
        setState(sessionId, next, immediate)
    }
}

function deriveSeqBounds(messages: DecryptedMessage[]): { oldestSeq: number | null; newestSeq: number | null } {
    let oldestSeq: number | null = null
    let newestSeq: number | null = null
    for (const message of messages) {
        if (typeof message.seq !== 'number') continue
        oldestSeq = oldestSeq === null ? message.seq : Math.min(oldestSeq, message.seq)
        newestSeq = newestSeq === null ? message.seq : Math.max(newestSeq, message.seq)
    }
    return { oldestSeq, newestSeq }
}

function messagePosition(message: DecryptedMessage): MessagePosition | null {
    return typeof message.seq === 'number'
        ? { at: message.invokedAt ?? message.createdAt, seq: message.seq }
        : null
}

function comparePosition(left: MessagePosition, right: MessagePosition): number {
    return left.at !== right.at ? left.at - right.at : left.seq - right.seq
}

function derivePosition(
    messages: DecryptedMessage[],
    direction: 'oldest' | 'newest'
): MessagePosition | null {
    let selected: MessagePosition | null = null
    for (const message of messages) {
        const candidate = messagePosition(message)
        if (!candidate) continue
        if (!selected) {
            selected = candidate
            continue
        }
        const comparison = comparePosition(candidate, selected)
        if ((direction === 'oldest' && comparison < 0) || (direction === 'newest' && comparison > 0)) {
            selected = candidate
        }
    }
    return selected
}

function getNewestCursor(state: InternalState): MessagePosition | null {
    return readPosition(state.newestPositionAt, state.newestPositionSeq)
}

function buildState(
    previous: InternalState,
    updates: Partial<Pick<InternalState,
        | 'messages'
        | 'hasMore'
        | 'epoch'
        | 'isSyncingTail'
        | 'isLoadingMore'
        | 'warning'
        | 'viewMode'
        | 'oldestPositionAt'
        | 'oldestPositionSeq'
        | 'newestPositionAt'
        | 'newestPositionSeq'
        | 'requiresLatestReset'
        | 'syncGeneration'
        | 'olderGeneration'
        | 'historyVersion'
        | 'tailRevision'
    >>
): InternalState {
    const messages = updates.messages ?? previous.messages
    const bounds = deriveSeqBounds(messages)
    return {
        ...previous,
        ...updates,
        messages,
        oldestSeq: bounds.oldestSeq,
        newestSeq: bounds.newestSeq,
        messagesVersion: messages === previous.messages
            ? previous.messagesVersion
            : previous.messagesVersion + 1
    }
}

function sliceForTrim<T>(
    items: T[],
    limit: number,
    mode: 'append' | 'prepend'
): { kept: T[]; dropped: T[] } {
    if (items.length <= limit) {
        return { kept: items, dropped: [] }
    }
    if (limit <= 0) {
        return { kept: [], dropped: items }
    }
    return mode === 'prepend'
        ? { kept: items.slice(0, limit), dropped: items.slice(limit) }
        : { kept: items.slice(items.length - limit), dropped: items.slice(0, items.length - limit) }
}


/**
 * Raw history is paged and trimmed before it is projected into chat responses.
 * Preserve user turns plus the final text and final raw item of every adjacent
 * assistant run so trimming cannot turn an arbitrary intermediate update into
 * the visible "final answer".
 */
function findConversationAnchorIds(messages: DecryptedMessage[]): Set<string> {
    const anchors = new Set<string>()
    let lastAgentMessageId: string | null = null
    let lastAgentTextId: string | null = null

    const flushAgentRun = () => {
        if (lastAgentTextId) anchors.add(lastAgentTextId)
        if (lastAgentMessageId) anchors.add(lastAgentMessageId)
        lastAgentMessageId = null
        lastAgentTextId = null
    }

    for (const message of messages) {
        const normalized = normalizeConversationUnitMessage(message)
        if (!normalized) continue

        if (normalized.role === 'user') {
            flushAgentRun()
            anchors.add(message.id)
            continue
        }
        if (normalized.role === 'event') {
            flushAgentRun()
            continue
        }

        lastAgentMessageId = message.id
        if (normalized.content.some((part) => (
            (part.type === 'text' && part.text.trim().length > 0)
            || part.type === 'codex-review'
        ))) {
            lastAgentTextId = message.id
        }
    }
    flushAgentRun()
    return anchors
}

/**
 * Count conversation units in a window, scanning from the end. A user prompt
 * is one unit; a consecutive run of agent messages is one unit regardless of
 * how many rounds (stream records) it spans.
 */
function countUnitsFromEnd(messages: DecryptedMessage[]): { userUnits: number; agentUnits: number } {
    let userUnits = 0
    let agentUnits = 0
    let insideAgentRun = false
    for (let index = messages.length - 1; index >= 0; index--) {
        const normalized = normalizeConversationUnitMessage(messages[index])
        if (!normalized) continue
        if (normalized.role === 'user') {
            userUnits += 1
            insideAgentRun = false
            continue
        }
        if (normalized.role === 'event') {
            insideAgentRun = false
            continue
        }
        if (!insideAgentRun) {
            agentUnits += 1
            insideAgentRun = true
        }
    }
    return { userUnits, agentUnits }
}

function hasInitialConversationCoverage(messages: DecryptedMessage[]): boolean {
    const { userUnits, agentUnits } = countUnitsFromEnd(messages)
    return userUnits >= INITIAL_USER_UNITS && agentUnits >= INITIAL_AGENT_UNITS
}

function countConversationUnits(messages: DecryptedMessage[]): number {
    return findConversationAnchorIds(messages).size
}

/**
 * Trim by conversation units instead of raw record counts. The newest (append
 * mode) or oldest (prepend mode) `maxUnits` units survive; queued messages are
 * always kept and codex agent-run cards keep their own record budget.
 */
function trimToUnitBudget(
    incoming: DecryptedMessage[],
    maxUnits: number,
    mode: 'append' | 'prepend'
): { kept: DecryptedMessage[]; dropped: DecryptedMessage[] } {
    const messages = dropSupersededReasoningSnapshots(incoming)
    const queued = messages.filter(isQueuedForInvocation)
    const queuedIds = new Set(queued.map((message) => message.id))
    const nonQueued = messages.filter((message) => !queuedIds.has(message.id))
    const agentRuns = nonQueued.filter(isCodexAgentRunMessage)
    const regular = nonQueued.filter((message) => !isCodexAgentRunMessage(message))
    const cutoffIndex = findUnitBudgetCutoff(regular, maxUnits, mode)
    const regularTrim = mode === 'append'
        ? { kept: regular.slice(cutoffIndex), dropped: regular.slice(0, cutoffIndex) }
        : { kept: regular.slice(0, cutoffIndex), dropped: regular.slice(cutoffIndex) }
    const agentRunTrim = sliceForTrim(agentRuns, AGENT_RUN_WINDOW_SIZE, mode)
    return {
        kept: mergeMessages([...regularTrim.kept, ...agentRunTrim.kept], queued),
        dropped: [...regularTrim.dropped, ...agentRunTrim.dropped]
    }
}

/**
 * Index into `regular` at which the unit budget is exceeded: everything before
 * (append mode) or after (prepend mode) the index is dropped. The cutoff
 * always lands on a unit boundary, so an agent run's records are never split
 * from their unit — append mode cuts off the whole run, prepend mode starts
 * the kept side at the run's first record.
 */
function findUnitBudgetCutoff(
    regular: DecryptedMessage[],
    maxUnits: number,
    mode: 'append' | 'prepend'
): number {
    let units = 0
    let insideAgentRun = false
    if (mode === 'append') {
        for (let index = regular.length - 1; index >= 0; index--) {
            const normalized = normalizeConversationUnitMessage(regular[index])
            if (!normalized) continue
            if (normalized.role === 'user') {
                units += 1
                insideAgentRun = false
            } else if (normalized.role === 'event') {
                insideAgentRun = false
            } else if (!insideAgentRun) {
                units += 1
                insideAgentRun = true
            }
            if (units > maxUnits) {
                return index + 1
            }
        }
        return 0
    }
    for (let index = 0; index < regular.length; index++) {
        const normalized = normalizeConversationUnitMessage(regular[index])
        if (!normalized) continue
        if (normalized.role === 'user') {
            units += 1
            insideAgentRun = false
        } else if (normalized.role === 'event') {
            insideAgentRun = false
        } else if (!insideAgentRun) {
            units += 1
            insideAgentRun = true
        }
        if (units > maxUnits) {
            return index
        }
    }
    return regular.length
}

function isCodexAgentRunMessage(message: DecryptedMessage): boolean {
    const outer = message.content
    if (!outer || typeof outer !== 'object' || (outer as { role?: unknown }).role !== 'agent') {
        return false
    }
    const content = (outer as { content?: unknown }).content
    if (!content || typeof content !== 'object') return false
    const payload = content as { type?: unknown; data?: unknown }
    if (payload.type !== 'codex' || !payload.data || typeof payload.data !== 'object') {
        return false
    }
    const type = (payload.data as { type?: unknown }).type
    return type === 'agent-run-start' || type === 'agent-run-update' || type === 'agent-run-trace'
}

/** Collapse a reasoning stream down to the one snapshot that still says
 *  something.
 *
 *  The CLI re-sends a growing reasoning buffer under a stable stream id every
 *  few hundred milliseconds, and the timeline already folds those snapshots
 *  into a single block by that id. Sessions recorded before the hub started
 *  retiring them still carry every intermediate, and spending window budget on
 *  rows that render as one block is what pushes the surrounding conversation
 *  out of reach. Messages with no stream id are left alone. */
function dropSupersededReasoningSnapshots(messages: DecryptedMessage[]): DecryptedMessage[] {
    const newestByStream = new Map<string, DecryptedMessage>()
    for (const message of messages) {
        const streamId = getReasoningStreamId(message.content)
        if (streamId === null) continue
        const incumbent = newestByStream.get(streamId)
        if (!incumbent) {
            newestByStream.set(streamId, message)
            continue
        }
        // Fall back to arrival order when either row predates seq numbering:
        // `messages` is kept in display order, so later still means newer.
        const challengerAt = messagePosition(message)
        const incumbentAt = messagePosition(incumbent)
        const newer = challengerAt && incumbentAt
            ? comparePosition(challengerAt, incumbentAt) >= 0
            : true
        if (newer) newestByStream.set(streamId, message)
    }
    if (newestByStream.size === 0) return messages

    const survivors = new Set<string>()
    for (const message of newestByStream.values()) survivors.add(message.id)
    return messages.filter((message) =>
        getReasoningStreamId(message.content) === null || survivors.has(message.id))
}

function optimisticMessage(message: DecryptedMessage): boolean {
    return Boolean(message.localId && message.id === message.localId)
}

function shouldRetainWindowMessage(message: DecryptedMessage): boolean {
    return isQueuedForInvocation(message) || normalizeWindowMessage(message) !== null
}

function normalizeWindowMessage(message: DecryptedMessage): ReturnType<typeof normalizeDecryptedMessage> {
    if (normalizedMessageCache.has(message)) {
        return normalizedMessageCache.get(message) ?? null
    }
    const normalized = normalizeDecryptedMessage(message)
    normalizedMessageCache.set(message, normalized)
    return normalized
}

/** Usage updates feed metadata but do not split a visible assistant response. */
function normalizeConversationUnitMessage(message: DecryptedMessage): ReturnType<typeof normalizeDecryptedMessage> {
    const normalized = normalizeWindowMessage(message)
    return normalized?.role === 'event' && normalized.content.type === 'token-count'
        ? null
        : normalized
}

function countNewRenderableMessages(
    previous: InternalState,
    incoming: DecryptedMessage[]
): number {
    const representedIds = new Set(previous.messages.map((message) => message.id))
    const representedLocalIds = new Set(
        previous.messages.flatMap((message) => message.localId ? [message.localId] : [])
    )
    let count = 0
    for (const message of incoming) {
        if (!shouldRetainWindowMessage(message)) continue
        if (representedIds.has(message.id)) continue
        if (message.localId && representedLocalIds.has(message.localId)) continue
        count += 1
        representedIds.add(message.id)
        if (message.localId) representedLocalIds.add(message.localId)
    }
    return count
}

function mergeIntoWindow(
    previous: InternalState,
    incoming: DecryptedMessage[],
    options: {
        mode?: 'append' | 'prepend'
        budgetUnits?: number
        advanceTailRevision?: boolean
    } = {}
): InternalState {
    const retainedIncoming = incoming.filter(shouldRetainWindowMessage)
    if (retainedIncoming.length === 0) {
        return previous
    }
    const mode = options.mode ?? (previous.viewMode === 'history' ? 'prepend' : 'append')
    const budgetUnits = options.budgetUnits
        ?? (previous.viewMode === 'history' ? HISTORY_UNIT_BUDGET : TAIL_UNIT_BUDGET)
    const merged = mergeMessages(previous.messages, retainedIncoming)
    const { kept, dropped } = trimToUnitBudget(merged, budgetUnits, mode)
    let next = buildState(previous, {
        messages: kept,
        ...(options.advanceTailRevision
            ? { tailRevision: previous.tailRevision + 1 }
            : {})
    })
    if (dropped.length === 0) {
        return next
    }
    if (mode === 'append') {
        const oldest = derivePosition(kept, 'oldest')
        return buildState(next, {
            hasMore: true,
            oldestPositionAt: oldest?.at ?? next.oldestPositionAt,
            oldestPositionSeq: oldest?.seq ?? next.oldestPositionSeq
        })
    }
    const newest = derivePosition(kept, 'newest')
    next = buildState(next, {
        requiresLatestReset: true,
        newestPositionAt: newest?.at ?? null,
        newestPositionSeq: newest?.seq ?? null
    })
    return next
}

function pagePosition(at: number | null, seq: number | null): MessagePosition | null {
    return at !== null && seq !== null ? { at, seq } : null
}

function applyLatestResponse(
    previous: InternalState,
    response: MessagesResponse,
    options: {
        replaceServerRows: boolean
        requestBaseline: Map<string, DecryptedMessage>
        budgetUnits?: number
        trimMode?: 'append' | 'prepend'
        bumpTailRevision?: boolean
    }
): InternalState {
    const dismissedIds = new Set(
        previous.messages
            .filter((message) => message.queueDismissed)
            .map((message) => message.id)
    )
    const retainedResponseMessages = response.messages
        .filter(shouldRetainWindowMessage)
        .map((message) => (
            dismissedIds.has(message.id)
            && message.invokedAt === null
            && message.deliveryState === 'indeterminate'
                ? { ...message, queueDismissed: true }
                : message
        ))
    const concurrentServerRows = previous.messages.filter((message) => (
        !optimisticMessage(message)
        && options.requestBaseline.get(message.id) !== message
    ))
    const preserved = options.replaceServerRows
        ? previous.messages.filter((message) => (
            optimisticMessage(message)
            || options.requestBaseline.get(message.id) !== message
        ))
        : previous.messages
    const authoritative = mergeMessages(preserved, retainedResponseMessages)
    const incoming = mergeMessages(authoritative, concurrentServerRows)
    const budgetUnits = options.budgetUnits ?? TAIL_UNIT_BUDGET
    const trimMode = options.trimMode ?? 'append'
    const { kept, dropped } = trimToUnitBudget(incoming, budgetUnits, trimMode)
    const bumpTailRevision = options.bumpTailRevision ?? true
    const snapshotHead = pagePosition(response.page.snapshotHeadAt, response.page.snapshotHeadSeq)
        ?? derivePosition(response.messages, 'newest')
    const responseOldest = pagePosition(response.page.nextBeforeAt, response.page.nextBeforeSeq)
    const previousOldest = readPosition(previous.oldestPositionAt, previous.oldestPositionSeq)
    const oldest = dropped.length > 0
        ? derivePosition(kept, 'oldest')
        : options.replaceServerRows
            ? responseOldest
            : responseOldest ?? previousOldest
    const next = buildState(previous, {
        messages: kept,
        hasMore: response.page.hasMore || (!options.replaceServerRows && previous.hasMore) || dropped.length > 0,
        epoch: response.page.epoch,
        oldestPositionAt: oldest?.at ?? null,
        oldestPositionSeq: oldest?.seq ?? null,
        newestPositionAt: snapshotHead?.at ?? null,
        newestPositionSeq: snapshotHead?.seq ?? null,
        tailRevision: bumpTailRevision ? previous.tailRevision + 1 : previous.tailRevision,
        requiresLatestReset: false,
        isLoadingMore: options.replaceServerRows ? false : previous.isLoadingMore,
        olderGeneration: options.replaceServerRows
            ? previous.olderGeneration + 1
            : previous.olderGeneration,
        warning: null
    })
    if (previous.viewMode === 'history') {
        // A latest response may be trimmed out of the reader's history window.
        // Cache that authoritative tail separately before applying the trim.
        const cached = cachedTails.get(previous.sessionId)
        const cacheRows = cached?.epoch === response.page.epoch && !response.page.reset
            ? mergeMessages(cached.messages, retainedResponseMessages)
            : retainedResponseMessages
        const cacheOldest = derivePosition(cacheRows, 'oldest')
        cachedTails.set(previous.sessionId, compactCachedTail(buildState(createState(previous.sessionId), {
            messages: cacheRows,
            hasMore: response.page.hasMore || cached?.hasMore === true,
            epoch: response.page.epoch,
            oldestPositionAt: cacheOldest?.at ?? null,
            oldestPositionSeq: cacheOldest?.seq ?? null,
            // The compacted snapshot may contain earlier rows outside this
            // page's coverage. Reconcile the full tail on re-entry.
            requiresLatestReset: true
        })))
    }
    return next
}

function beginTailSync(sessionId: string): number {
    let generation = 0
    updateState(sessionId, (previous) => {
        generation = previous.syncGeneration + 1
        return buildState(previous, {
            syncGeneration: generation,
            // Tail reconciliation owns the authoritative epoch. An older-page
            // response captured before this point must not commit while the tail
            // request is in flight, or a reset can mistake it for concurrent SSE.
            olderGeneration: previous.olderGeneration + 1,
            isSyncingTail: true,
            isLoadingMore: false,
            warning: null
        })
    })
    return generation
}

function isCurrentTailSync(sessionId: string, generation: number): boolean {
    return getState(sessionId).syncGeneration === generation
}

function finishTailSync(sessionId: string, generation: number, warning: string | null): void {
    updateState(sessionId, (previous) => {
        if (previous.syncGeneration !== generation) {
            return previous
        }
        return buildState(previous, { isSyncingTail: false, warning })
    })
}

async function runTailSync(api: ApiClient, sessionId: string): Promise<void> {
    const generation = beginTailSync(sessionId)
    try {
        const initial = getState(sessionId)
        const initialCursor = getNewestCursor(initial)
        const canIncrement = initialCursor !== null
            && initial.epoch !== null
            && !initial.requiresLatestReset

        if (!canIncrement) {
            const requestBaseline = new Map(getState(sessionId).messages.map((message) => [message.id, message]))
            // Cold windows and structural resets replace the window with the
            // newest usable page, then extend backwards until it shows the
            // initial conversation coverage (see `extendToInitialCoverage`).
            const response = await api.getMessages(sessionId, { limit: PAGE_SIZE })
            if (!isCurrentTailSync(sessionId, generation)) return
            updateState(sessionId, (previous) => {
                if (previous.syncGeneration !== generation) return previous
                return applyLatestResponse(previous, response, {
                    replaceServerRows: initial.epoch === null
                        || initial.requiresLatestReset
                        || response.page.reset,
                    requestBaseline
                })
            })
            await extendToInitialCoverage(api, sessionId, generation)
            await restoreLatestAfterCoverage(api, sessionId, generation)
            finishTailSync(sessionId, generation, null)
            return
        }

        let after = initialCursor
        let until: MessagePosition | null = null
        while (true) {
            const requestBaseline = new Map(getState(sessionId).messages.map((message) => [message.id, message]))
            const response = await api.getMessages(sessionId, {
                afterAt: after.at,
                afterSeq: after.seq,
                untilAt: until?.at ?? null,
                untilSeq: until?.seq ?? null,
                epoch: initial.epoch,
                limit: PAGE_SIZE
            })
            if (!isCurrentTailSync(sessionId, generation)) return

            if (response.page.reset || response.page.direction === 'latest') {
                updateState(sessionId, (previous) => {
                    if (previous.syncGeneration !== generation) return previous
                    return applyLatestResponse(previous, response, {
                        replaceServerRows: true,
                        requestBaseline
                    })
                })
                break
            }

            const nextAfter = pagePosition(response.page.nextAfterAt, response.page.nextAfterSeq)
            const snapshotHead = pagePosition(response.page.snapshotHeadAt, response.page.snapshotHeadSeq)
            if (until === null) {
                until = snapshotHead
            }

            updateState(sessionId, (previous) => {
                if (previous.syncGeneration !== generation) return previous
                const merged = mergeIntoWindow(previous, response.messages, {
                    advanceTailRevision: true
                })
                if (merged.requiresLatestReset) {
                    return buildState(merged, {
                        epoch: response.page.epoch,
                        warning: null
                    })
                }
                const currentNewest = getNewestCursor(merged)
                const newest = nextAfter && currentNewest
                    ? (comparePosition(nextAfter, currentNewest) >= 0 ? nextAfter : currentNewest)
                    : nextAfter ?? currentNewest
                return buildState(merged, {
                    epoch: response.page.epoch,
                    newestPositionAt: newest?.at ?? null,
                    newestPositionSeq: newest?.seq ?? null,
                    warning: null
                })
            })

            const current = getState(sessionId)
            if (
                current.requiresLatestReset
                || !response.page.hasMore
                || !nextAfter
            ) {
                break
            }
            if (comparePosition(nextAfter, after) <= 0) {
                throw new Error('Message tail cursor did not advance')
            }
            after = nextAfter
        }

        await extendToInitialCoverage(api, sessionId, generation)
        await restoreLatestAfterCoverage(api, sessionId, generation)
        finishTailSync(sessionId, generation, null)
    } catch (error) {
        if (!isCurrentTailSync(sessionId, generation)) return
        finishTailSync(
            sessionId,
            generation,
            error instanceof Error ? error.message : 'Failed to synchronize messages'
        )
    }
}

/**
 * Prepend older pages until the window ends with the initial conversation
 * coverage (the last user/agent exchanges). This is the cold-window first
 * paint path: without it a record-dense session would open showing only the
 * tail of the newest agent turn. Explicit swipes remain the only way to load
 * history beyond this target.
 */
async function extendToInitialCoverage(api: ApiClient, sessionId: string, generation: number): Promise<void> {
    for (let page = 0; page < INITIAL_COVERAGE_MAX_PAGES; page++) {
        const state = getState(sessionId)
        if (!isCurrentTailSync(sessionId, generation)) return
        if (hasInitialConversationCoverage(state.messages)) return
        const before = readPosition(state.oldestPositionAt, state.oldestPositionSeq)
        if (!before || !state.hasMore) return
        const response = await api.getMessages(sessionId, {
            beforeAt: before.at,
            beforeSeq: before.seq,
            limit: PAGE_SIZE
        })
        if (!isCurrentTailSync(sessionId, generation)) return
        updateState(sessionId, (previous) => {
            if (previous.syncGeneration !== generation) return previous
            const merged = mergeIntoWindow(previous, response.messages, {
                mode: 'prepend',
                budgetUnits: HISTORY_UNIT_BUDGET
            })
            return buildState(merged, {
                hasMore: response.page.hasMore,
                epoch: response.page.epoch,
                oldestPositionAt: response.page.nextBeforeAt,
                oldestPositionSeq: response.page.nextBeforeSeq
            })
        }, true)
    }
}

/**
 * The coverage extension prepends older pages with the history budget, so a
 * tail without reachable coverage (e.g. pages of user rows with no agent
 * finals) can evict the newest rows and flag `requiresLatestReset`. Close the
 * sync with a fresh latest fetch so the window never rests on stale
 * mid-history content.
 */
async function restoreLatestAfterCoverage(api: ApiClient, sessionId: string, generation: number): Promise<void> {
    const state = getState(sessionId)
    if (!isCurrentTailSync(sessionId, generation) || !state.requiresLatestReset) return
    // The cold-window backfill trims newer rows to fit the history budget and
    // sets `requiresLatestReset` so a fresh latest fetch refreshes the tail.
    // That refresh is destructive — it replaces the window. If the user has
    // already scrolled into the loaded history, the latest page they asked for
    // is no longer on screen, and a replace would yank them back to a single
    // page of the latest 120 messages. Skip the refresh; the next time the
    // user scrolls to the bottom, `activateMessageWindow` will refill the tail.
    if (state.viewMode !== 'tail') return
    const requestBaseline = new Map(state.messages.map((message) => [message.id, message]))
    const response = await api.getMessages(sessionId, { limit: PAGE_SIZE })
    if (!isCurrentTailSync(sessionId, generation)) return
    updateState(sessionId, (previous) => {
        if (previous.syncGeneration !== generation) return previous
        return applyLatestResponse(previous, response, {
            replaceServerRows: true,
            requestBaseline
        })
    })
}

/**
 * After a user-initiated older-page load (`fetchOlderMessages`) the prepend
 * may have trimmed the newest side to fit the history budget, flagging the
 * window with `requiresLatestReset`. Unlike the cold-window tail sync, no
 * outer caller runs `restoreLatestAfterCoverage` — so we refill the latest
 * here ourselves. We merge with `replaceServerRows: false` and use a
 * `prepend` trim so the rows the user just loaded stay visible (a plain
 * `append` trim would drop them as soon as the latest page arrived and the
 * user would be stuck on the same top-of-window after every click). The
 * latest side falls out of the budget and is reloaded when the user
 * scrolls back to the bottom (which flips the view back to `tail` via
 * `activateMessageWindow`).
 */
async function refillLatestAfterUserHistoryLoad(
    api: ApiClient,
    sessionId: string,
    olderGeneration: number
): Promise<void> {
    const state = getState(sessionId)
    if (state.olderGeneration !== olderGeneration || !state.requiresLatestReset) return
    const requestBaseline = new Map(state.messages.map((message) => [message.id, message]))
    const response = await api.getMessages(sessionId, { limit: PAGE_SIZE })
    if (getState(sessionId).olderGeneration !== olderGeneration) return
    updateState(sessionId, (previous) => {
        if (previous.olderGeneration !== olderGeneration) return previous
        return applyLatestResponse(previous, response, {
            replaceServerRows: false,
            requestBaseline,
            budgetUnits: HISTORY_UNIT_BUDGET,
            trimMode: 'prepend',
            bumpTailRevision: false
        })
    })
}

function startTailSync(sessionId: string, controller: TailSyncController): Promise<void> {
    const running = runTailSync(controller.api, sessionId)
    controller.running = running
    const finish = () => {
        if (tailSyncControllers.get(sessionId) !== controller || controller.running !== running) {
            return
        }
        controller.running = null
        if (!controller.trailingRequested) {
            return
        }
        controller.trailingRequested = false
        startTailSync(sessionId, controller)
    }
    void running.then(finish, finish)
    return running
}

async function waitForTailSyncDrain(
    sessionId: string,
    controller: TailSyncController,
    observed: Promise<void>
): Promise<void> {
    await observed
    if (tailSyncControllers.get(sessionId) !== controller) {
        return
    }
    const current = controller.running
    if (current && current !== observed) {
        await waitForTailSyncDrain(sessionId, controller, current)
    }
}

function enterTailMode(previous: InternalState): InternalState {
    const tail = cachedTails.get(previous.sessionId)
    if (previous.viewMode === 'history' && previous.requiresLatestReset && tail) {
        previous = restoreCachedTail(previous, tail)
    }
    const { kept, dropped } = trimToUnitBudget(previous.messages, TAIL_UNIT_BUDGET, 'append')
    const forceLatest = previous.requiresLatestReset
    const oldest = dropped.length > 0
        ? derivePosition(kept, 'oldest')
        : readPosition(previous.oldestPositionAt, previous.oldestPositionSeq)
    return buildState(previous, {
        messages: kept,
        hasMore: previous.hasMore || dropped.length > 0,
        viewMode: 'tail',
        epoch: forceLatest ? null : previous.epoch,
        oldestPositionAt: oldest?.at ?? null,
        oldestPositionSeq: oldest?.seq ?? null,
        newestPositionAt: forceLatest ? null : previous.newestPositionAt,
        newestPositionSeq: forceLatest ? null : previous.newestPositionSeq
    })
}

export function activateMessageWindow(sessionId: string): void {
    updateState(sessionId, (previous) => {
        const { kept } = trimToUnitBudget(previous.messages, TAIL_UNIT_BUDGET, 'append')
        const forceLatest = previous.requiresLatestReset
        // A persisted cursor may be many pages behind after another client
        // has added messages. The incremental tail sync started by the
        // consumer catches the window up; no authoritative replace is needed.
        if (
            previous.viewMode === 'tail'
            && kept.length === previous.messages.length
            && !forceLatest
        ) {
            return previous
        }
        return enterTailMode(previous)
    }, true)
}

export function syncTailMessages(
    api: ApiClient,
    sessionId: string,
    options: { ensureAfterCurrent?: boolean } = {}
): Promise<void> {
    let controller = tailSyncControllers.get(sessionId)
    if (!controller) {
        controller = {
            api,
            running: null,
            trailingRequested: false
        }
        tailSyncControllers.set(sessionId, controller)
    }
    controller.api = api
    if (!controller.running) {
        return startTailSync(sessionId, controller)
    }
    const observed = controller.running
    if (!options.ensureAfterCurrent) {
        return observed
    }
    controller.trailingRequested = true
    return waitForTailSyncDrain(sessionId, controller, observed)
}

export async function fetchOlderMessages(
    api: ApiClient,
    sessionId: string,
    options: {
        onBeforeApply?: (historyVersion: number) => boolean
    } = {}
): Promise<OlderLoadOutcome> {
    const initial = getState(sessionId)
    const before = readPosition(initial.oldestPositionAt, initial.oldestPositionSeq)
    if (initial.isSyncingTail || initial.isLoadingMore) {
        return { kind: 'stopped', reason: 'busy' }
    }
    if (!initial.hasMore) {
        return { kind: 'stopped', reason: 'exhausted' }
    }
    if (!before) {
        return { kind: 'stopped', reason: 'unavailable' }
    }
    const generation = initial.olderGeneration + 1
    updateState(sessionId, (previous) => buildState(previous, {
        olderGeneration: generation,
        isLoadingMore: true,
        warning: null
    }))

    try {
        let cursor: MessagePosition | null = before
        let historyVersion = 0
        let addedRenderableCount = 0
        let lastPageHasMore: boolean = initial.hasMore
        // One swipe must surface at least one conversation unit. In a
        // record-dense session a single page can sit entirely inside the
        // newest agent turn and fold into nothing visible, so keep paging
        // (bounded) until a unit actually appears.
        for (let page = 0; page < OLDER_LOAD_MAX_PAGES; page++) {
            const response = await api.getMessages(sessionId, {
                beforeAt: cursor.at,
                beforeSeq: cursor.seq,
                limit: PAGE_SIZE
            })
            if (getState(sessionId).olderGeneration !== generation) {
                return { kind: 'stopped', reason: 'invalidated' }
            }

            if (initial.epoch !== null && response.page.epoch !== initial.epoch) {
                if (page === 0) {
                    updateState(sessionId, (previous) => {
                        if (previous.olderGeneration !== generation) return previous
                        return buildState(previous, {
                            isLoadingMore: false,
                            epoch: null,
                            newestPositionAt: null,
                            newestPositionSeq: null,
                            requiresLatestReset: true
                        })
                    })
                    await syncTailMessages(api, sessionId, { ensureAfterCurrent: true })
                    return { kind: 'stopped', reason: 'epoch-reset' }
                }
                break
            }

            const unitsBefore = countConversationUnits(getState(sessionId).messages)
            let applyRejected = false
            // The first applied page and its prepared scroll restore must
            // reach the UI in one publication; the normal 150ms notification
            // throttle would expose rows that this state has already evicted.
            // Follow-up pages ride the throttle; the final apply publishes
            // immediately below.
            updateState(sessionId, (previous) => {
                if (previous.olderGeneration !== generation) return previous
                addedRenderableCount += countNewRenderableMessages(previous, response.messages)
                if (page === 0) {
                    const nextHistoryVersion = previous.historyVersion + 1
                    if (options.onBeforeApply && !options.onBeforeApply(nextHistoryVersion)) {
                        applyRejected = true
                        return buildState(previous, {
                            olderGeneration: previous.olderGeneration + 1,
                            isLoadingMore: false,
                            warning: null
                        })
                    }
                    historyVersion = nextHistoryVersion
                }
                const merged = mergeIntoWindow(previous, response.messages, {
                    mode: 'prepend',
                    budgetUnits: HISTORY_UNIT_BUDGET
                })
                return buildState(merged, {
                    hasMore: response.page.hasMore,
                    historyVersion,
                    epoch: response.page.epoch,
                    oldestPositionAt: response.page.nextBeforeAt,
                    oldestPositionSeq: response.page.nextBeforeSeq,
                    isLoadingMore: page === OLDER_LOAD_MAX_PAGES - 1,
                    warning: null
                })
            }, page === 0)
            if (applyRejected || historyVersion === 0) {
                return { kind: 'stopped', reason: 'invalidated' }
            }
            lastPageHasMore = response.page.hasMore
            cursor = pagePosition(response.page.nextBeforeAt, response.page.nextBeforeSeq)
            const addedUnits = countConversationUnits(getState(sessionId).messages) - unitsBefore
            if (addedUnits > 0 || !response.page.hasMore || !cursor) {
                break
            }
        }

        // The prepend's HISTORY_UNIT_BUDGET trim drops newer rows when the
        // window overflows, which leaves `requiresLatestReset` set. Unlike the
        // cold-window backfill (which closes the tail sync with
        // `restoreLatestAfterCoverage`), user-initiated older-page loads have
        // no caller for that step — so the dangling flag would let the next
        // tail sync wipe every message the user just loaded. Refill the latest
        // page here, preserving the loaded history.
        const finalState = getState(sessionId)
        if (
            finalState.olderGeneration === generation
            && finalState.requiresLatestReset
        ) {
            await refillLatestAfterUserHistoryLoad(api, sessionId, generation)
        }

        updateState(sessionId, (previous) => {
            if (previous.olderGeneration !== generation) return previous
            return buildState(previous, { isLoadingMore: false })
        }, true)
        return {
            kind: 'applied',
            historyVersion,
            hasMore: lastPageHasMore,
            addedRenderableCount
        }
    } catch (error) {
        if (getState(sessionId).olderGeneration !== generation) {
            return { kind: 'stopped', reason: 'invalidated' }
        }
        const loadError = error instanceof Error
            ? error
            : new Error('Failed to load older messages')
        updateState(sessionId, (previous) => {
            if (previous.olderGeneration !== generation) return previous
            return buildState(previous, {
                isLoadingMore: false,
                warning: loadError.message
            })
        })
        return { kind: 'failed', error: loadError }
    }
}

export function cancelOlderMessageLoad(sessionId: string): void {
    updateState(sessionId, (previous) => {
        if (!previous.isLoadingMore) {
            return previous
        }
        return buildState(previous, {
            olderGeneration: previous.olderGeneration + 1,
            isLoadingMore: false,
            warning: null
        })
    }, true)
}

export function setMessageViewMode(sessionId: string, mode: MessageViewMode): void {
    updateState(sessionId, (previous) => {
        if (previous.viewMode === mode) {
            return previous
        }
        if (mode === 'history') {
            return buildState(previous, { viewMode: 'history' })
        }
        return enterTailMode(previous)
    }, true)
}

export function ingestIncomingMessages(sessionId: string, incoming: DecryptedMessage[]): void {
    if (incoming.length === 0) return
    const previous = getState(sessionId)
    const tail = cachedTails.get(sessionId)
    if (tail && (previous.viewMode === 'history' || previous.requiresLatestReset)) {
        cachedTails.set(sessionId, compactCachedTail(mergeIntoWindow(tail, incoming, {
            mode: 'append', budgetUnits: CACHE_UNIT_BUDGET
        })))
    }
    // Live events can arrive after a missed interval or ahead of a REST page. Display them immediately, but only REST can certify a covered cursor.
    updateState(sessionId, (previous) => mergeIntoWindow(previous, incoming, {
        advanceTailRevision: true
    }))
}

export function getMessageWindowState(sessionId: string): MessageWindowState {
    return getState(sessionId)
}

export function subscribeMessageWindow(sessionId: string, listener: () => void): () => void {
    const subscribers = listeners.get(sessionId) ?? new Set()
    subscribers.add(listener)
    listeners.set(sessionId, subscribers)
    return () => {
        const current = listeners.get(sessionId)
        if (!current) return
        current.delete(listener)
        if (current.size === 0) {
            listeners.delete(sessionId)
            schedulePersist(sessionId)
        }
    }
}

export function clearMessageWindow(sessionId: string): void {
    tailSyncControllers.delete(sessionId)
    clearPersistedState(sessionId)
    const previous = states.get(sessionId)
    if (!previous) return
    setState(sessionId, {
        ...createState(sessionId),
        syncGeneration: previous.syncGeneration + 1,
        olderGeneration: previous.olderGeneration + 1
    }, true)
}

function markMessageWindowForLatestReset(sessionId: string, messages: DecryptedMessage[]): void {
    const previous = states.get(sessionId)
    if (!previous) return

    tailSyncControllers.delete(sessionId)
    clearPersistedState(sessionId)
    setState(sessionId, buildState(previous, {
        messages,
        epoch: null,
        oldestPositionAt: null,
        oldestPositionSeq: null,
        newestPositionAt: null,
        newestPositionSeq: null,
        requiresLatestReset: true,
        isSyncingTail: true,
        isLoadingMore: false,
        warning: null,
        syncGeneration: previous.syncGeneration + 1,
        olderGeneration: previous.olderGeneration + 1
    }), true)
}

/**
 * Mark the current window stale without exposing an empty transcript while a
 * latest snapshot is fetched. The next tail sync sees `requiresLatestReset`
 * and replaces server rows atomically with the authoritative response.
 */
export function invalidateMessageWindow(sessionId: string): void {
    const previous = states.get(sessionId)
    if (!previous) return

    markMessageWindowForLatestReset(sessionId, previous.messages)
}

/**
 * Apply the known local effect of a successful Rewind before the server
 * snapshot arrives. Rewind removes the boundary message and every later row;
 * retaining the earlier prefix keeps the chat usable and lets the current
 * bottom position clamp directly to the new tail.
 */
export function rewindMessageWindow(sessionId: string, messageLocalId: string): void {
    const previous = states.get(sessionId)
    if (!previous) return

    const applied = appliedRewindLocalIds.get(sessionId) ?? new Set<string>()
    if (applied.has(messageLocalId)) return
    applied.add(messageLocalId)
    appliedRewindLocalIds.set(sessionId, applied)

    const boundaryIndex = previous.messages.findIndex((message) => message.localId === messageLocalId)
    if (boundaryIndex < 0) {
        // The boundary may be outside the current latest window. Without a
        // local boundary, retaining rows could show messages removed by the
        // rewind until the authoritative tail sync completes.
        clearMessageWindow(sessionId)
        return
    }

    const messages = previous.messages.slice(0, boundaryIndex)

    markMessageWindowForLatestReset(sessionId, messages)
}

export function seedMessageWindowFromSession(fromSessionId: string, toSessionId: string): void {
    if (!fromSessionId || !toSessionId || fromSessionId === toSessionId) return
    const source = getState(fromSessionId)
    const target = getState(toSessionId)
    const seeded = buildState(createState(toSessionId), {
        messages: [...source.messages],
        hasMore: source.hasMore,
        tailRevision: source.tailRevision,
        oldestPositionAt: source.oldestPositionAt,
        oldestPositionSeq: source.oldestPositionSeq,
        requiresLatestReset: true,
        syncGeneration: target.syncGeneration + 1,
        olderGeneration: target.olderGeneration + 1
    })
    tailSyncControllers.delete(toSessionId)
    setState(toSessionId, seeded, true)
}

function isQueuedReconcileCandidate(message: DecryptedMessage): boolean {
    if (!message.localId || !isQueuedForInvocation(message)) return false
    if (!optimisticMessage(message)) return true
    return message.status === 'queued' || message.status === 'sent'
}

export function getQueuedReconcileCandidateLocalIds(sessionId: string): string[] {
    const localIds = new Set<string>()
    for (const message of getState(sessionId).messages) {
        if (isQueuedReconcileCandidate(message)) {
            localIds.add(message.localId!)
        }
    }
    return [...localIds]
}

export function reconcileQueuedLocalIds(
    sessionId: string,
    candidateLocalIds: string[],
    queuedLocalIds: string[]
): void {
    if (candidateLocalIds.length === 0) return
    const candidates = new Set(candidateLocalIds)
    const queued = new Set(queuedLocalIds)
    updateState(sessionId, (previous) => {
        const messages = previous.messages.filter((message) => {
            if (!message.localId || !candidates.has(message.localId)) return true
            return queued.has(message.localId) || !isQueuedReconcileCandidate(message)
        })
        return messages.length === previous.messages.length
            ? previous
            : buildState(previous, { messages })
    }, true)
}

export function appendOptimisticMessage(sessionId: string, message: DecryptedMessage): void {
    updateState(sessionId, (previous) => {
        return mergeIntoWindow(previous, [message], {
            mode: previous.viewMode === 'history' ? 'prepend' : 'append',
            advanceTailRevision: true
        })
    }, true)
}

export function updateMessageStatus(sessionId: string, localId: string, status: MessageStatus): void {
    if (!localId) return
    updateState(sessionId, (previous) => {
        let changed = false
        const messages = previous.messages.map((message) => {
            if (message.localId !== localId || message.status === status) return message
            changed = true
            return { ...message, status }
        })
        return changed ? buildState(previous, { messages }) : previous
    })
}

export function removeOptimisticMessage(sessionId: string, localId: string): void {
    if (!localId) return
    updateState(sessionId, (previous) => {
        const messages = previous.messages.filter(
            (message) => message.localId !== localId && message.id !== localId
        )
        return messages.length === previous.messages.length
            ? previous
            : buildState(previous, { messages })
    }, true)
}

export function markMessagesIndeterminate(sessionId: string, localIds: string[]): void {
    if (localIds.length === 0) return
    const idSet = new Set(localIds)
    updateState(sessionId, (previous) => {
        let changed = false
        const messages = previous.messages.map((message) => {
            if (!message.localId || !idSet.has(message.localId) || message.deliveryState === 'indeterminate') {
                return message
            }
            changed = true
            return { ...message, deliveryState: 'indeterminate' as const }
        })
        return changed ? buildState(previous, { messages }) : previous
    }, true)
}

export function markMessagesRequeued(sessionId: string, localIds: string[]): void {
    if (localIds.length === 0) return
    const idSet = new Set(localIds)
    updateState(sessionId, (previous) => {
        let changed = false
        const messages = previous.messages.map((message) => {
            if (
                !message.localId
                || !idSet.has(message.localId)
                || (message.deliveryState === undefined && message.queueDismissed !== true)
            ) {
                return message
            }
            changed = true
            const {
                deliveryState: _deliveryState,
                queueDismissed: _queueDismissed,
                ...requeued
            } = message
            return requeued
        })
        return changed ? buildState(previous, { messages }) : previous
    }, true)
}

export function markMessagesConsumed(
    sessionId: string,
    localIds: string[],
    invokedAt: number,
    steered?: boolean
): void {
    if (localIds.length === 0) return
    const idSet = new Set(localIds)
    updateState(sessionId, (previous) => {
        let changed = false
        const updated = previous.messages.map((message) => {
            if (!message.localId || !idSet.has(message.localId) || message.status === 'failed') {
                return message
            }
            const needsStatus = message.status !== 'sent'
            const needsInvokedAt = message.invokedAt === null
            const needsSteered = steered === true && message.steered !== true
            const needsClearDismiss = message.queueDismissed === true
            if (!needsStatus && !needsInvokedAt && !needsSteered && !needsClearDismiss) return message
            changed = true
            const { deliveryState: _deliveryState, queueDismissed: _queueDismissed, ...withoutClientHold } = message
            return {
                ...withoutClientHold,
                ...(needsStatus ? { status: 'sent' as MessageStatus } : {}),
                ...(needsInvokedAt ? { invokedAt } : {}),
                ...(needsSteered ? { steered: true } : {})
            }
        })
        if (!changed) return previous
        return buildState(previous, {
            messages: mergeMessages([], updated),
            tailRevision: previous.tailRevision + 1
        })
    })
}
