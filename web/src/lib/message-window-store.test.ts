import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ApiClient } from '@/api/client'
import type { DecryptedMessage, MessagesResponse } from '@/types/api'
import {
    HISTORY_UNIT_BUDGET,
    TAIL_UNIT_BUDGET,
    activateMessageWindow,
    appendOptimisticMessage,
    clearMessageWindow,
    fetchOlderMessages,
    getMessageWindowState,
    getQueuedReconcileCandidateLocalIds,
    ingestIncomingMessages,
    invalidateMessageWindow,
    markMessagesConsumed,
    reconcileQueuedLocalIds,
    removeOptimisticMessage,
    rewindMessageWindow,
    setMessageViewMode,
    syncTailMessages,
    updateMessageStatus,
    type MessageWindowState,
} from '@/lib/message-window-store'

const touchedSessions = new Set<string>()

function sessionId(name: string): string {
    const id = `message-window-v2-${name}`
    touchedSessions.add(id)
    return id
}

function makeUserMessage(props: {
    id: string
    seq?: number | null
    localId?: string | null
    createdAt?: number
    invokedAt?: number | null
    status?: DecryptedMessage['status']
    scheduledAt?: number | null
}): DecryptedMessage {
    return {
        id: props.id,
        seq: props.seq ?? null,
        localId: props.localId ?? null,
        content: {
            role: 'user',
            content: { type: 'text', text: props.id }
        },
        createdAt: props.createdAt ?? 1_000,
        invokedAt: props.invokedAt,
        scheduledAt: props.scheduledAt,
        status: props.status,
        originalText: props.id
    } as DecryptedMessage
}

function makeAgentMessage(props: {
    id: string
    seq: number
    at: number
    invokedAt?: number | null
}): DecryptedMessage {
    return {
        id: props.id,
        seq: props.seq,
        localId: null,
        content: {
            role: 'agent',
            content: {
                type: 'codex',
                data: { type: 'message', message: props.id }
            }
        },
        createdAt: props.at,
        invokedAt: props.invokedAt !== undefined ? props.invokedAt : props.at
    } as DecryptedMessage
}

function makeHiddenAgentMessage(props: { id: string; seq: number; at: number }): DecryptedMessage {
    return {
        id: props.id,
        seq: props.seq,
        localId: null,
        content: {
            role: 'agent',
            content: {
                type: 'output',
                data: { type: 'system', isMeta: true }
            }
        },
        createdAt: props.at,
        invokedAt: props.at
    } as DecryptedMessage
}

function makeReasoningMessage(id: string, streamId: string, seq: number, at: number, live = true): DecryptedMessage {
    return {
        id,
        seq,
        localId: null,
        content: {
            role: 'agent',
            content: {
                type: 'codex',
                data: { type: 'reasoning', message: id, id: streamId, ...(live ? { live: true } : {}) }
            }
        },
        createdAt: at,
        invokedAt: at
    } as DecryptedMessage
}

function makeAgentRunMessage(id: string, seq: number, at: number): DecryptedMessage {
    return {
        id,
        seq,
        localId: null,
        content: {
            role: 'agent',
            content: {
                type: 'codex',
                data: {
                    type: 'agent-run-update',
                    cardId: 'card-1',
                    agentId: 'agent-1',
                    status: 'running',
                    activity: id
                }
            }
        },
        createdAt: at,
        invokedAt: at
    } as DecryptedMessage
}

/** A user prompt followed by its agent reply: two conversation units. */
function makeExchange(index: number, baseSeq: number, agentId = `agent-${index}`): DecryptedMessage[] {
    return [
        makeUserMessage({
            id: `user-${index}`,
            seq: baseSeq,
            invokedAt: baseSeq,
            createdAt: baseSeq
        }),
        makeAgentMessage({ id: agentId, seq: baseSeq + 1, at: baseSeq + 1 })
    ]
}

/** Newest-page rows that already show two user and two agent units, so the
 *  tail sync's coverage backfill has nothing left to fetch. */
function coverageTail(latest: DecryptedMessage[], startSeq: number): DecryptedMessage[] {
    return [
        ...makeExchange(1, startSeq, 'coverage-agent-1'),
        ...makeExchange(2, startSeq + 2, 'coverage-agent-2'),
        ...latest
    ]
}

function latestResponse(
    messages: DecryptedMessage[],
    options: {
        limit?: number
        epoch?: number
        hasMore?: boolean
        reset?: boolean
        nextBeforeAt?: number | null
        nextBeforeSeq?: number | null
        snapshotHeadAt?: number | null
        snapshotHeadSeq?: number | null
    } = {}
): MessagesResponse {
    const newest = [...messages]
        .filter((message) => typeof message.seq === 'number')
        .sort((left, right) => (left.invokedAt ?? left.createdAt) - (right.invokedAt ?? right.createdAt))
        .at(-1)
    return {
        messages,
        page: {
            direction: 'latest',
            limit: options.limit ?? 200,
            epoch: options.epoch ?? 0,
            reset: options.reset ?? false,
            nextBeforeAt: options.nextBeforeAt ?? null,
            nextBeforeSeq: options.nextBeforeSeq ?? null,
            nextAfterAt: null,
            nextAfterSeq: null,
            snapshotHeadAt: options.snapshotHeadAt
                ?? (newest ? newest.invokedAt ?? newest.createdAt : null),
            snapshotHeadSeq: options.snapshotHeadSeq
                ?? (typeof newest?.seq === 'number' ? newest.seq : null),
            hasMore: options.hasMore ?? false
        }
    }
}

function afterResponse(
    messages: DecryptedMessage[],
    options: {
        epoch?: number
        hasMore?: boolean
        nextAfterAt: number
        nextAfterSeq: number
        snapshotHeadAt: number
        snapshotHeadSeq: number
    }
): MessagesResponse {
    return {
        messages,
        page: {
            direction: 'after',
            limit: 200,
            epoch: options.epoch ?? 0,
            reset: false,
            nextBeforeAt: null,
            nextBeforeSeq: null,
            nextAfterAt: options.nextAfterAt,
            nextAfterSeq: options.nextAfterSeq,
            snapshotHeadAt: options.snapshotHeadAt,
            snapshotHeadSeq: options.snapshotHeadSeq,
            hasMore: options.hasMore ?? false
        }
    }
}

function beforeResponse(
    messages: DecryptedMessage[],
    options: {
        epoch?: number
        hasMore?: boolean
        nextBeforeAt: number | null
        nextBeforeSeq: number | null
    }
): MessagesResponse {
    return {
        messages,
        page: {
            direction: 'before',
            limit: 200,
            epoch: options.epoch ?? 0,
            reset: false,
            nextBeforeAt: options.nextBeforeAt,
            nextBeforeSeq: options.nextBeforeSeq,
            nextAfterAt: null,
            nextAfterSeq: null,
            snapshotHeadAt: null,
            snapshotHeadSeq: null,
            hasMore: options.hasMore ?? false
        }
    }
}

function createApi(getMessages: ApiClient['getMessages']): ApiClient {
    return { getMessages } as ApiClient
}

/** The compound older cursor lives on the internal state behind
 *  MessageWindowState; tests pin its numeric half directly. */
function oldestCursorAt(id: string): number | null {
    return (getMessageWindowState(id) as MessageWindowState & { oldestPositionAt: number | null })
        .oldestPositionAt
}

function deferred<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void
    let reject!: (reason?: unknown) => void
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise
        reject = rejectPromise
    })
    return { promise, resolve, reject }
}

afterEach(() => {
    for (const id of touchedSessions) {
        clearMessageWindow(id)
    }
    touchedSessions.clear()
    sessionStorage.clear()
    vi.restoreAllMocks()
})

describe('message tail synchronization', () => {
    it('cold sync fetches full pages and extends backwards until the initial exchanges are visible', async () => {
        const id = sessionId('cold-initial-page')
        // The newest page is one record-dense agent turn: a single conversation
        // unit that on its own would render as an almost empty chat.
        const denseTail = Array.from({ length: 200 }, (_, index) =>
            makeAgentMessage({
                id: `tail-${index + 1}`,
                seq: index + 1,
                at: (index + 1) * 1_000
            })
        )
        const denseMiddle = Array.from({ length: 200 }, (_, index) =>
            makeAgentMessage({
                id: `middle-${index + 1}`,
                seq: index + 201,
                at: (index + 201) * 1_000
            })
        )
        const covered = [
            ...makeExchange(1, 1),
            ...makeExchange(2, 3)
        ]
        const getMessages = vi.fn()
            .mockResolvedValueOnce(latestResponse(denseTail, {
                epoch: 1,
                hasMore: true,
                nextBeforeAt: 1_000,
                nextBeforeSeq: 1
            }))
            .mockResolvedValueOnce(beforeResponse(denseMiddle, {
                epoch: 1,
                hasMore: true,
                nextBeforeAt: 201_000,
                nextBeforeSeq: 201
            }))
            .mockResolvedValueOnce(beforeResponse(covered, {
                epoch: 1,
                hasMore: false,
                nextBeforeAt: 1,
                nextBeforeSeq: 1
            }))
        const api = createApi(getMessages)

        await syncTailMessages(api, id)

        // The cold latest page and every coverage page share the same page
        // size; the extension stops as soon as two exchanges are visible.
        expect(getMessages).toHaveBeenCalledTimes(3)
        expect(getMessages.mock.calls[0]?.[1]).toEqual({ limit: 200 })
        expect(getMessages.mock.calls[1]?.[1]).toEqual({ beforeAt: 1_000, beforeSeq: 1, limit: 200 })
        expect(getMessages.mock.calls[2]?.[1]).toEqual({ beforeAt: 201_000, beforeSeq: 201, limit: 200 })
        const messages = getMessageWindowState(id).messages
        expect(messages).toHaveLength(404)
        expect(messages[0]?.id).toBe('user-1')
        expect(messages.some((message) => message.id === 'tail-200')).toBe(true)
    })

    it('restores the newest page when the coverage extension evicts the tail', async () => {
        const id = sessionId('coverage-evicts-tail')
        // Every page is a wall of user rows: the coverage target (two agent
        // finals) is unreachable, so the extension walks its full page budget
        // and each prepend with the history budget evicts the newest rows.
        const userPage = (startSeq: number) => Array.from({ length: 200 }, (_, index) =>
            makeUserMessage({
                id: `u-${startSeq + index}`,
                seq: startSeq + index,
                createdAt: (startSeq + index) * 1_000
            }))
        const getMessages = vi.fn()
            .mockResolvedValueOnce(latestResponse(userPage(1001), {
                epoch: 1,
                hasMore: true,
                nextBeforeAt: 1_001_000,
                nextBeforeSeq: 1001
            }))
            .mockResolvedValueOnce(beforeResponse(userPage(801), {
                epoch: 1,
                hasMore: true,
                nextBeforeAt: 801_000,
                nextBeforeSeq: 801
            }))
            .mockResolvedValueOnce(beforeResponse(userPage(601), {
                epoch: 1,
                hasMore: true,
                nextBeforeAt: 601_000,
                nextBeforeSeq: 601
            }))
            .mockResolvedValueOnce(beforeResponse(userPage(401), {
                epoch: 1,
                hasMore: true,
                nextBeforeAt: 401_000,
                nextBeforeSeq: 401
            }))
            .mockResolvedValueOnce(beforeResponse(userPage(201), {
                epoch: 1,
                hasMore: false,
                nextBeforeAt: 201_000,
                nextBeforeSeq: 201
            }))
            .mockResolvedValueOnce(latestResponse(userPage(1001), {
                epoch: 1,
                hasMore: true,
                nextBeforeAt: 1_001_000,
                nextBeforeSeq: 1001
            }))
        const api = createApi(getMessages)

        await syncTailMessages(api, id)

        // The restore refetch closes the sync with a fresh latest page.
        expect(getMessages).toHaveBeenCalledTimes(6)
        expect(getMessages.mock.calls[5]?.[1]).toEqual({ limit: 200 })
        expect(getMessageWindowState(id).messages.at(-1)?.id).toBe('u-1200')
    })

    it('removes the rewound suffix immediately and applies duplicate invalidations once', async () => {
        const id = sessionId('rewind-suffix')
        const prefix = makeAgentMessage({ id: 'prefix', seq: 1, at: 1_000 })
        const target = makeUserMessage({
            id: 'target',
            seq: 2,
            localId: 'target-local-id',
            createdAt: 2_000,
            invokedAt: 2_000
        })
        const suffix = makeAgentMessage({ id: 'suffix', seq: 3, at: 3_000 })
        const getMessages = vi.fn(async () => latestResponse([prefix, target, suffix], { epoch: 1 }))

        await syncTailMessages(createApi(getMessages), id)
        rewindMessageWindow(id, 'target-local-id')
        rewindMessageWindow(id, 'target-local-id')

        expect(getMessageWindowState(id).messages.map((message) => message.id)).toEqual(['prefix'])
        expect(getMessageWindowState(id).isSyncingTail).toBe(true)
    })

    it('clears the window when the rewind boundary is outside the loaded page', async () => {
        const id = sessionId('rewind-boundary-not-loaded')
        const current = makeAgentMessage({ id: 'current', seq: 40, at: 40_000 })
        const getMessages = vi.fn(async () => latestResponse([current], { epoch: 1 }))

        await syncTailMessages(createApi(getMessages), id)
        rewindMessageWindow(id, 'boundary-not-loaded')

        expect(getMessageWindowState(id).messages).toEqual([])
    })

    it('deduplicates delayed rewind events across consecutive boundaries', async () => {
        const id = sessionId('rewind-delayed-event')
        const prefix = makeAgentMessage({ id: 'prefix', seq: 1, at: 1_000 })
        const firstBoundary = makeUserMessage({
            id: 'first-boundary',
            seq: 2,
            localId: 'first-boundary-local-id',
            createdAt: 2_000,
            invokedAt: 2_000
        })
        const secondBoundary = makeUserMessage({
            id: 'second-boundary',
            seq: 3,
            localId: 'second-boundary-local-id',
            createdAt: 3_000,
            invokedAt: 3_000
        })
        const suffix = makeAgentMessage({ id: 'suffix', seq: 4, at: 4_000 })
        const getMessages = vi.fn(async () => latestResponse(
            [prefix, firstBoundary, secondBoundary, suffix],
            { epoch: 1 }
        ))

        await syncTailMessages(createApi(getMessages), id)
        rewindMessageWindow(id, 'second-boundary-local-id')
        rewindMessageWindow(id, 'first-boundary-local-id')
        rewindMessageWindow(id, 'second-boundary-local-id')

        expect(getMessageWindowState(id).messages.map((message) => message.id)).toEqual(['prefix'])
    })

    it('retains the current window while a latest reset is in flight', async () => {
        const id = sessionId('invalidation-preserves-window')
        const current = makeAgentMessage({ id: 'current', seq: 10, at: 10_000 })
        const latest = makeAgentMessage({ id: 'latest', seq: 20, at: 20_000 })
        const response = deferred<MessagesResponse>()
        const getMessages = vi.fn()
            .mockResolvedValueOnce(latestResponse([current], { epoch: 1 }))
            .mockImplementationOnce(async () => await response.promise)
        const api = createApi(getMessages)

        await syncTailMessages(api, id)
        invalidateMessageWindow(id)

        expect(getMessageWindowState(id).messages.map((message) => message.id)).toEqual(['current'])
        expect(getMessageWindowState(id).isSyncingTail).toBe(true)

        const syncing = syncTailMessages(api, id)
        await vi.waitFor(() => expect(getMessages).toHaveBeenCalledTimes(2))
        expect(getMessages.mock.calls[1]?.[1]).toEqual({ limit: 200 })

        response.resolve(latestResponse([latest], { epoch: 2 }))
        await syncing

        expect(getMessageWindowState(id).messages.map((message) => message.id)).toEqual(['latest'])
        expect(getMessageWindowState(id).isSyncingTail).toBe(false)
    })

    it('renders a persisted window immediately, then catches it up incrementally on re-entry', async () => {
        const id = sessionId('reentry')
        const cached = [
            ...makeExchange(1, 37_000, 'cached-agent-1'),
            ...makeExchange(2, 39_000, 'cached-agent-2')
        ]
        sessionStorage.setItem(`hapi:message-window:v2:${id}`, JSON.stringify({
            messages: cached,
            hasMore: true,
            oldestPositionAt: 37_000,
            oldestPositionSeq: 37_000,
            newestPositionAt: 39_001,
            newestPositionSeq: 39_001,
            epoch: 3
        }))

        expect(getMessageWindowState(id).messages[3]?.id).toBe('cached-agent-2')
        setMessageViewMode(id, 'history')
        activateMessageWindow(id)
        expect(getMessageWindowState(id).viewMode).toBe('tail')

        const response = deferred<MessagesResponse>()
        const getMessages = vi.fn(async (..._call: unknown[]) => await response.promise)
        const syncing = syncTailMessages(createApi(getMessages), id)

        expect(getMessageWindowState(id).isSyncingTail).toBe(true)
        await vi.waitFor(() => expect(getMessages).toHaveBeenCalledTimes(1))
        expect(getMessages.mock.calls[0]?.[1]).toEqual({
            afterAt: 39_001,
            afterSeq: 39_001,
            untilAt: null,
            untilSeq: null,
            epoch: 3,
            limit: 200
        })
        expect(getMessageWindowState(id).messages[3]?.id).toBe('cached-agent-2')

        const latest = makeAgentMessage({ id: 'latest', seq: 2_040, at: 2_040_000 })
        response.resolve(latestResponse([latest], { limit: 200, epoch: 3 }))
        await syncing

        // The authoritative latest page replaces the stale server rows; the
        // cached rows drop out and stay reachable through older pagination.
        expect(getMessageWindowState(id).messages.map((message) => message.id)).toEqual(['latest'])
        expect('pending' in getMessageWindowState(id)).toBe(false)
    })

    it('preserves queued rows while replacing stale server rows on re-entry', async () => {
        const id = sessionId('reentry-queued')
        const cached = makeAgentMessage({ id: 'cached', seq: 40, at: 4_000 })
        const queued = makeUserMessage({
            id: 'local-1',
            localId: 'local-1',
            createdAt: 4_100,
            invokedAt: null,
            status: 'queued'
        })
        sessionStorage.setItem(`hapi:message-window:v2:${id}`, JSON.stringify({
            messages: [cached, queued],
            hasMore: true,
            oldestPositionAt: 4_000,
            oldestPositionSeq: 40,
            newestPositionAt: 4_000,
            newestPositionSeq: 40,
            epoch: 3
        }))

        activateMessageWindow(id)
        const latest = makeAgentMessage({ id: 'latest', seq: 2_000, at: 200_000 })
        const getMessages = vi.fn(async (..._call: unknown[]) => latestResponse([latest], { epoch: 3 }))
        await syncTailMessages(createApi(getMessages), id)

        expect(getMessages.mock.calls[0]?.[1]).toEqual({
            afterAt: 4_000,
            afterSeq: 40,
            untilAt: null,
            untilSeq: null,
            epoch: 3,
            limit: 200
        })
        expect(getMessageWindowState(id).messages.map((message) => message.id)).toEqual([
            'local-1',
            'latest'
        ])
        expect(getMessageWindowState(id).messages).toContainEqual(expect.objectContaining({
            id: 'local-1',
            status: 'queued'
        }))
    })

    it('re-entry catch-up replaces stale rows and backfills the initial exchanges', async () => {
        const id = sessionId('reentry-older-history')
        const cached = makeAgentMessage({ id: 'cached', seq: 40, at: 40_000 })
        sessionStorage.setItem(`hapi:message-window:v2:${id}`, JSON.stringify({
            messages: [cached],
            hasMore: true,
            oldestPositionAt: 40_000,
            oldestPositionSeq: 40,
            newestPositionAt: 40_000,
            newestPositionSeq: 40,
            epoch: 3
        }))

        activateMessageWindow(id)
        const latest = makeAgentMessage({ id: 'latest', seq: 41, at: 41_000 })
        const olderFirst = [
            makeUserMessage({ id: 'user-1', seq: 38, invokedAt: 38_000, createdAt: 38_000 }),
            makeAgentMessage({ id: 'agent-1', seq: 39, at: 38_500 })
        ]
        const olderSecond = [
            makeUserMessage({ id: 'user-2', seq: 36, invokedAt: 36_000, createdAt: 36_000 }),
            makeAgentMessage({ id: 'agent-2', seq: 37, at: 36_500 })
        ]
        const getMessages = vi.fn()
            .mockResolvedValueOnce(latestResponse([latest], {
                epoch: 3,
                hasMore: true,
                nextBeforeAt: 40_000,
                nextBeforeSeq: 40
            }))
            .mockResolvedValueOnce(beforeResponse(olderFirst, {
                epoch: 3,
                hasMore: true,
                nextBeforeAt: 38_000,
                nextBeforeSeq: 38
            }))
            .mockResolvedValueOnce(beforeResponse(olderSecond, {
                epoch: 3,
                hasMore: false,
                nextBeforeAt: 36_000,
                nextBeforeSeq: 36
            }))
        const api = createApi(getMessages)

        await syncTailMessages(api, id)

        expect(getMessages.mock.calls[0]?.[1]).toEqual({
            afterAt: 40_000,
            afterSeq: 40,
            untilAt: null,
            untilSeq: null,
            epoch: 3,
            limit: 200
        })
        expect(getMessages.mock.calls[1]?.[1]).toEqual({ beforeAt: 40_000, beforeSeq: 40, limit: 200 })
        expect(getMessages.mock.calls[2]?.[1]).toEqual({ beforeAt: 38_000, beforeSeq: 38, limit: 200 })
        expect(getMessageWindowState(id).messages.map((message) => message.id)).toEqual([
            'user-2',
            'agent-2',
            'user-1',
            'agent-1',
            'latest'
        ])
        expect(getMessageWindowState(id).hasMore).toBe(false)
    })

    it('keeps cached messages visible when the re-entry refresh fails', async () => {
        const id = sessionId('reentry-refresh-failure')
        const cached = makeAgentMessage({ id: 'cached', seq: 40, at: 40_000 })
        sessionStorage.setItem(`hapi:message-window:v2:${id}`, JSON.stringify({
            messages: [cached],
            hasMore: true,
            oldestPositionAt: 40_000,
            oldestPositionSeq: 40,
            newestPositionAt: 40_000,
            newestPositionSeq: 40,
            epoch: 3
        }))

        activateMessageWindow(id)
        const getMessages = vi.fn(async (..._call: unknown[]) => {
            throw new Error('latest tail unavailable')
        })

        await syncTailMessages(createApi(getMessages), id)

        expect(getMessages.mock.calls[0]?.[1]).toEqual({
            afterAt: 40_000,
            afterSeq: 40,
            untilAt: null,
            untilSeq: null,
            epoch: 3,
            limit: 200
        })
        expect(getMessageWindowState(id)).toMatchObject({
            messages: [cached],
            isSyncingTail: false,
            warning: 'latest tail unavailable'
        })
    })

    it('preserves live and optimistic rows that arrive during a re-entry refresh', async () => {
        const id = sessionId('reentry-concurrent-rows')
        const cached = makeAgentMessage({ id: 'cached', seq: 40, at: 40_000 })
        sessionStorage.setItem(`hapi:message-window:v2:${id}`, JSON.stringify({
            messages: [cached],
            hasMore: true,
            oldestPositionAt: 40_000,
            oldestPositionSeq: 40,
            newestPositionAt: 40_000,
            newestPositionSeq: 40,
            epoch: 3
        }))

        activateMessageWindow(id)
        const response = deferred<MessagesResponse>()
        const getMessages = vi.fn(async (..._call: unknown[]) => await response.promise)
        const syncing = syncTailMessages(createApi(getMessages), id)
        await vi.waitFor(() => expect(getMessages).toHaveBeenCalledTimes(1))
        expect(getMessages.mock.calls[0]?.[1]).toEqual({
            afterAt: 40_000,
            afterSeq: 40,
            untilAt: null,
            untilSeq: null,
            epoch: 3,
            limit: 200
        })

        const optimistic = makeUserMessage({
            id: 'local-1',
            localId: 'local-1',
            createdAt: 41_000,
            invokedAt: null,
            status: 'sending'
        })
        appendOptimisticMessage(id, optimistic)
        const live = makeAgentMessage({ id: 'live', seq: 41, at: 41_000 })
        ingestIncomingMessages(id, [live])

        response.resolve(latestResponse([
            makeAgentMessage({ id: 'latest', seq: 2_040, at: 2_040_000 })
        ], { limit: 20, epoch: 3 }))
        await syncing

        expect(getMessageWindowState(id).messages.map((message) => message.id)).toEqual([
            'live',
            'local-1',
            'latest'
        ])
    })

    it('keeps incremental synchronization for non-activation refreshes', async () => {
        const id = sessionId('incremental-refresh')
        const cached = makeAgentMessage({ id: 'cached', seq: 40, at: 40_000 })
        sessionStorage.setItem(`hapi:message-window:v2:${id}`, JSON.stringify({
            messages: [cached],
            hasMore: true,
            oldestPositionAt: 40_000,
            oldestPositionSeq: 40,
            newestPositionAt: 40_000,
            newestPositionSeq: 40,
            epoch: 3
        }))

        const latest = makeAgentMessage({ id: 'latest', seq: 41, at: 41_000 })
        const getMessages = vi.fn(async () => afterResponse([latest], {
            epoch: 3,
            nextAfterAt: 41_000,
            nextAfterSeq: 41,
            snapshotHeadAt: 41_000,
            snapshotHeadSeq: 41
        }))
        await syncTailMessages(createApi(getMessages), id)

        expect(getMessages).toHaveBeenCalledWith(id, {
            afterAt: 40_000,
            afterSeq: 40,
            untilAt: null,
            untilSeq: null,
            epoch: 3,
            limit: 200
        })
        expect(getMessageWindowState(id).messages.map((message) => message.id)).toEqual([
            'cached',
            'latest'
        ])
    })

    it('preserves SSE rows that arrive while the latest snapshot is in flight', async () => {
        const id = sessionId('latest-sse-race')
        const response = deferred<MessagesResponse>()
        const getMessages = vi.fn(async (..._call: unknown[]) => await response.promise)
        const syncing = syncTailMessages(createApi(getMessages), id)

        ingestIncomingMessages(id, [
            makeAgentMessage({ id: 'concurrent', seq: 2, at: 2_000 })
        ])
        response.resolve(latestResponse([
            makeAgentMessage({ id: 'snapshot', seq: 1, at: 1_000 })
        ], { epoch: 1 }))
        await syncing

        expect(getMessageWindowState(id).messages.map((message) => message.id)).toEqual([
            'snapshot',
            'concurrent'
        ])
        expect(getMessageWindowState(id).newestSeq).toBe(2)
    })

    it('reconciles an optimistic send echoed by an in-flight latest response', async () => {
        const id = sessionId('latest-optimistic-echo')
        const response = deferred<MessagesResponse>()
        const syncing = syncTailMessages(createApi(vi.fn(async () => await response.promise)), id)
        appendOptimisticMessage(id, makeUserMessage({
            id: 'local-1',
            localId: 'local-1',
            createdAt: 1_000,
            invokedAt: null,
            status: 'sending'
        }))

        response.resolve(latestResponse([
            makeUserMessage({
                id: 'server-1',
                seq: 1,
                localId: 'local-1',
                createdAt: 1_000,
                invokedAt: null
            })
        ], { epoch: 1 }))
        await syncing

        expect(getMessageWindowState(id).messages).toEqual([
            expect.objectContaining({
                id: 'server-1',
                localId: 'local-1',
                status: 'sending'
            })
        ])
    })

    it('uses the oldest retained row after a latest and SSE merge trims the window', async () => {
        const id = sessionId('latest-sse-trim-cursor')
        const response = deferred<MessagesResponse>()
        const getMessages = vi.fn()
            .mockImplementationOnce(async () => await response.promise)
            .mockResolvedValueOnce(beforeResponse([], {
                epoch: 1,
                hasMore: false,
                nextBeforeAt: null,
                nextBeforeSeq: null
            }))
        const api = createApi(getMessages)
        const syncing = syncTailMessages(api, id)

        ingestIncomingMessages(id, Array.from({ length: 130 }, (_, index) => {
            const userSeq = 300 + index * 2
            return [
                makeUserMessage({ id: `concurrent-user-${index}`, seq: userSeq, invokedAt: userSeq, createdAt: userSeq }),
                makeAgentMessage({ id: `concurrent-agent-${index}`, seq: userSeq + 1, at: userSeq + 1 })
            ]
        }).flat())
        response.resolve(latestResponse(
            Array.from({ length: 200 }, (_, index) => {
                const seq = index + 1
                return makeAgentMessage({ id: `snapshot-${seq}`, seq, at: seq })
            }),
            {
                epoch: 1,
                hasMore: false,
                nextBeforeAt: 1,
                nextBeforeSeq: 1
            }
        ))
        await syncing

        // The merged window holds 261 conversation units, past the tail
        // budget: it keeps the newest 120 units and the older-page cursor
        // becomes the oldest retained row, not the stale server cursor.
        await fetchOlderMessages(api, id)

        expect(getMessages.mock.calls[1]?.[1]).toEqual({
            beforeAt: 440,
            beforeSeq: 440,
            limit: 200
        })
    })

    it('commits each forward page before the next page resolves', async () => {
        const id = sessionId('page-commit')
        const initial = makeAgentMessage({ id: 'initial', seq: 1, at: 1_000 })
        const firstDelta = makeAgentMessage({ id: 'delta-1', seq: 2, at: 2_000 })
        const secondDelta = makeAgentMessage({ id: 'delta-2', seq: 3, at: 3_000 })
        const secondPage = deferred<MessagesResponse>()
        let call = 0
        const getMessages = vi.fn(async (..._call: unknown[]) => {
            call += 1
            if (call === 1) return latestResponse([initial], { epoch: 1 })
            if (call === 2) {
                return afterResponse([firstDelta], {
                    epoch: 1,
                    nextAfterAt: 2_000,
                    nextAfterSeq: 2,
                    snapshotHeadAt: 3_000,
                    snapshotHeadSeq: 3,
                    hasMore: true
                })
            }
            return await secondPage.promise
        })
        const api = createApi(getMessages)
        await syncTailMessages(api, id)

        const syncing = syncTailMessages(api, id)
        await vi.waitFor(() => {
            expect(getMessageWindowState(id).messages.map((message) => message.id)).toContain('delta-1')
            expect(getMessages).toHaveBeenCalledTimes(3)
        })
        expect(getMessageWindowState(id).isSyncingTail).toBe(true)

        secondPage.resolve(afterResponse([secondDelta], {
            epoch: 1,
            nextAfterAt: 3_000,
            nextAfterSeq: 3,
            snapshotHeadAt: 3_000,
            snapshotHeadSeq: 3
        }))
        await syncing

        expect(getMessageWindowState(id).messages.map((message) => message.id)).toEqual([
            'initial',
            'delta-1',
            'delta-2'
        ])
    })

    it('keeps the newest SSE cursor when a forward page finishes behind it', async () => {
        const id = sessionId('forward-sse-cursor')
        const initial = makeAgentMessage({ id: 'initial', seq: 10, at: 1_000 })
        const stalePage = deferred<MessagesResponse>()
        const getMessages = vi.fn()
            .mockResolvedValueOnce(latestResponse([initial], { epoch: 5 }))
            .mockImplementationOnce(async () => await stalePage.promise)
            .mockResolvedValueOnce(afterResponse([], {
                epoch: 5,
                nextAfterAt: 1_200,
                nextAfterSeq: 12,
                snapshotHeadAt: 1_200,
                snapshotHeadSeq: 12
            }))
        const api = createApi(getMessages)
        await syncTailMessages(api, id)

        const syncing = syncTailMessages(api, id)
        await vi.waitFor(() => expect(getMessages).toHaveBeenCalledTimes(2))
        ingestIncomingMessages(id, [
            makeAgentMessage({ id: 'concurrent', seq: 12, at: 1_200 })
        ])
        stalePage.resolve(afterResponse([
            makeAgentMessage({ id: 'page', seq: 11, at: 1_100 })
        ], {
            epoch: 5,
            nextAfterAt: 1_100,
            nextAfterSeq: 11,
            snapshotHeadAt: 1_100,
            snapshotHeadSeq: 11
        }))
        await syncing

        await syncTailMessages(api, id)

        expect(getMessages.mock.calls[2]?.[1]).toEqual({
            afterAt: 1_200,
            afterSeq: 12,
            untilAt: null,
            untilSeq: null,
            epoch: 5,
            limit: 200
        })
        expect(getMessageWindowState(id).messages.map((message) => message.id)).toEqual([
            'initial',
            'page',
            'concurrent'
        ])
    })

    it('re-entry joins the in-flight incremental synchronization', async () => {
        const id = sessionId('reentry-in-flight')
        const cached = [
            ...makeExchange(1, 37_000, 'cached-agent-1'),
            ...makeExchange(2, 39_000, 'cached-agent-2')
        ]
        sessionStorage.setItem(`hapi:message-window:v2:${id}`, JSON.stringify({
            messages: cached,
            hasMore: true,
            oldestPositionAt: 37_000,
            oldestPositionSeq: 37_000,
            newestPositionAt: 39_001,
            newestPositionSeq: 39_001,
            epoch: 3
        }))

        const staleResponse = deferred<MessagesResponse>()
        const getMessages = vi.fn()
            .mockImplementationOnce(async () => await staleResponse.promise)
        const api = createApi(getMessages)
        const initialSync = syncTailMessages(api, id)
        await vi.waitFor(() => expect(getMessages).toHaveBeenCalledTimes(1))

        activateMessageWindow(id)
        const reentrySync = syncTailMessages(api, id)

        // Activation no longer prioritizes a fresh latest snapshot: while an
        // incremental synchronization is in flight, re-entry waits for it.
        staleResponse.resolve(afterResponse([
            makeAgentMessage({ id: 'fresh', seq: 41, at: 41_000 })
        ], {
            epoch: 3,
            nextAfterAt: 41_000,
            nextAfterSeq: 41,
            snapshotHeadAt: 41_000,
            snapshotHeadSeq: 41
        }))

        await initialSync
        await reentrySync

        expect(getMessages).toHaveBeenCalledTimes(1)
        expect(getMessageWindowState(id).messages.map((message) => message.id)).toEqual([
            'user-1',
            'cached-agent-1',
            'user-2',
            'cached-agent-2',
            'fresh'
        ])
    })

    it('deduplicates SSE and REST delivery while preserving the authoritative invocation timestamp', async () => {
        const id = sessionId('dedupe')
        const initial = makeAgentMessage({ id: 'initial', seq: 1, at: 1_000 })
        const getMessages = vi.fn()
            .mockResolvedValueOnce(latestResponse([initial], { epoch: 2 }))
            .mockResolvedValueOnce(afterResponse([
                makeAgentMessage({ id: 'same', seq: 2, at: 1_500, invokedAt: null })
            ], {
                epoch: 2,
                nextAfterAt: 2_000,
                nextAfterSeq: 2,
                snapshotHeadAt: 2_000,
                snapshotHeadSeq: 2
            }))
        const api = createApi(getMessages)
        await syncTailMessages(api, id)

        ingestIncomingMessages(id, [makeAgentMessage({ id: 'same', seq: 2, at: 1_500, invokedAt: 2_000 })])
        await syncTailMessages(api, id)

        const matches = getMessageWindowState(id).messages.filter((message) => message.id === 'same')
        expect(matches).toHaveLength(1)
        expect(matches[0]?.invokedAt).toBe(2_000)
    })

    it('does not advance the tail cursor from an out-of-band consumed update', async () => {
        const id = sessionId('consumed-cursor-gap')
        const queued = makeUserMessage({
            id: 'queued',
            seq: 1,
            localId: 'local-1',
            createdAt: 1_000,
            invokedAt: null,
            status: 'queued'
        })
        const getMessages = vi.fn()
            .mockResolvedValueOnce(latestResponse([queued], { epoch: 1 }))
            .mockResolvedValueOnce(afterResponse([
                makeAgentMessage({ id: 'missed', seq: 2, at: 2_000 })
            ], {
                epoch: 1,
                nextAfterAt: 3_000,
                nextAfterSeq: 1,
                snapshotHeadAt: 3_000,
                snapshotHeadSeq: 1
            }))
        const api = createApi(getMessages)
        await syncTailMessages(api, id)

        markMessagesConsumed(id, ['local-1'], 3_000)
        await syncTailMessages(api, id)

        expect(getMessages.mock.calls[1]?.[1]).toEqual({
            afterAt: 1_000,
            afterSeq: 1,
            untilAt: null,
            untilSeq: null,
            epoch: 1,
            limit: 200
        })
        expect(getMessageWindowState(id).messages.map((message) => message.id)).toEqual([
            'missed',
            'queued'
        ])
    })

    it('runs a guaranteed trailing request after an in-flight synchronization', async () => {
        const id = sessionId('trailing')
        const firstRequest = deferred<MessagesResponse>()
        const secondRequest = deferred<MessagesResponse>()
        const getMessages = vi.fn()
            .mockImplementationOnce(async () => await firstRequest.promise)
            .mockImplementationOnce(async () => await secondRequest.promise)
        const api = createApi(getMessages)

        const first = syncTailMessages(api, id)
        const trailing = syncTailMessages(api, id, { ensureAfterCurrent: true })
        expect(getMessages).toHaveBeenCalledTimes(1)

        firstRequest.resolve(latestResponse([
            makeAgentMessage({ id: 'first', seq: 1, at: 1_000 })
        ], { epoch: 1 }))
        await first
        await vi.waitFor(() => expect(getMessages).toHaveBeenCalledTimes(2))

        let trailingResolved = false
        void trailing.then(() => {
            trailingResolved = true
        })
        await Promise.resolve()
        expect(trailingResolved).toBe(false)

        secondRequest.resolve(afterResponse([], {
            epoch: 1,
            nextAfterAt: 1_000,
            nextAfterSeq: 1,
            snapshotHeadAt: 1_000,
            snapshotHeadSeq: 1
        }))
        await trailing
        expect(trailingResolved).toBe(true)
    })

    it('replaces stale server rows on epoch reset and preserves a not-yet-echoed optimistic send', async () => {
        const id = sessionId('epoch-reset')
        const old = makeAgentMessage({ id: 'old', seq: 1, at: 1_000 })
        const fresh = makeAgentMessage({ id: 'fresh', seq: 2, at: 2_000 })
        const optimistic = makeUserMessage({
            id: 'local-1',
            localId: 'local-1',
            createdAt: 1_500,
            invokedAt: null,
            status: 'sending'
        })
        const getMessages = vi.fn()
            .mockResolvedValueOnce(latestResponse([old], { epoch: 1 }))
            .mockResolvedValueOnce(latestResponse([fresh], { epoch: 2, reset: true }))
        const api = createApi(getMessages)
        await syncTailMessages(api, id)
        appendOptimisticMessage(id, optimistic)

        await syncTailMessages(api, id)

        const state = getMessageWindowState(id)
        expect(state.messages.map((message) => message.id)).toEqual(['local-1', 'fresh'])
        expect(state.epoch).toBe(2)
    })

    it('preserves concurrent SSE and optimistic rows while applying an epoch reset', async () => {
        const id = sessionId('epoch-reset-sse-race')
        const old = makeAgentMessage({ id: 'old', seq: 1, at: 1_000 })
        const reset = deferred<MessagesResponse>()
        const getMessages = vi.fn()
            .mockResolvedValueOnce(latestResponse([old], { epoch: 1 }))
            .mockImplementationOnce(async () => await reset.promise)
        const api = createApi(getMessages)
        await syncTailMessages(api, id)
        appendOptimisticMessage(id, makeUserMessage({
            id: 'local-reset',
            localId: 'local-reset',
            createdAt: 1_500,
            invokedAt: null,
            status: 'sending'
        }))

        const syncing = syncTailMessages(api, id)
        await vi.waitFor(() => expect(getMessages).toHaveBeenCalledTimes(2))
        ingestIncomingMessages(id, [
            makeAgentMessage({ id: 'concurrent', seq: 3, at: 3_000 })
        ])
        reset.resolve(latestResponse([
            makeAgentMessage({ id: 'fresh', seq: 2, at: 2_000 })
        ], { epoch: 2, reset: true }))
        await syncing

        const state = getMessageWindowState(id)
        expect(state.messages.map((message) => message.id)).toEqual([
            'local-reset',
            'fresh',
            'concurrent'
        ])
        expect(state.epoch).toBe(2)
        expect(state.newestSeq).toBe(3)
    })

    it('removes earlier HTTP pages when the epoch resets later in the same catch-up', async () => {
        const id = sessionId('mid-catch-up-reset')
        const reset = deferred<MessagesResponse>()
        const getMessages = vi.fn()
            .mockResolvedValueOnce(latestResponse([
                makeAgentMessage({ id: 'initial', seq: 1, at: 1_000 })
            ], { epoch: 1 }))
            .mockResolvedValueOnce(afterResponse([
                makeAgentMessage({ id: 'stale-page', seq: 2, at: 2_000 })
            ], {
                epoch: 1,
                nextAfterAt: 2_000,
                nextAfterSeq: 2,
                snapshotHeadAt: 3_000,
                snapshotHeadSeq: 3,
                hasMore: true
            }))
            .mockImplementationOnce(async () => await reset.promise)
        const api = createApi(getMessages)
        await syncTailMessages(api, id)

        const syncing = syncTailMessages(api, id)
        await vi.waitFor(() => expect(getMessages).toHaveBeenCalledTimes(3))
        ingestIncomingMessages(id, [
            makeAgentMessage({ id: 'concurrent', seq: 11, at: 11_000 })
        ])
        reset.resolve(latestResponse([
            makeAgentMessage({ id: 'fresh', seq: 10, at: 10_000 })
        ], { epoch: 2, reset: true }))
        await syncing

        expect(getMessageWindowState(id).messages.map((message) => message.id)).toEqual([
            'fresh',
            'concurrent'
        ])
        expect(getMessageWindowState(id).epoch).toBe(2)
    })

    it('invalidates an old request when the window is cleared and reloaded', async () => {
        const id = sessionId('clear-generation')
        const stale = deferred<MessagesResponse>()
        const getMessages = vi.fn()
            .mockImplementationOnce(async () => await stale.promise)
            .mockResolvedValueOnce(latestResponse([
                makeAgentMessage({ id: 'fresh', seq: 2, at: 2_000 })
            ], { epoch: 0 }))
        const api = createApi(getMessages)

        const oldSync = syncTailMessages(api, id)
        clearMessageWindow(id)
        await syncTailMessages(api, id)
        stale.reject(new Error('stale failure'))
        await oldSync

        expect(getMessageWindowState(id).messages.map((message) => message.id)).toEqual(['fresh'])
        expect(getMessageWindowState(id).warning).toBeNull()
    })

    it('stops backfilling older pages once the initial conversation coverage is reached', async () => {
        const id = sessionId('no-cold-backfill')
        // A page of nothing but agent-run trace cards carries zero conversation
        // units, so the cold sync must reach past it for the initial view.
        const traceRows = Array.from({ length: 200 }, (_, index) =>
            makeAgentRunMessage(`trace-${index}`, index + 101, index + 10_000)
        )
        const getMessages = vi.fn()
            .mockResolvedValueOnce(latestResponse(traceRows, {
                epoch: 0,
                hasMore: true,
                nextBeforeAt: 10_000,
                nextBeforeSeq: 101
            }))
            .mockResolvedValueOnce(beforeResponse([
                ...makeExchange(1, 97),
                ...makeExchange(2, 99)
            ], {
                epoch: 0,
                hasMore: true,
                nextBeforeAt: 97,
                nextBeforeSeq: 97
            }))

        await syncTailMessages(createApi(getMessages), id)

        expect(getMessages).toHaveBeenCalledTimes(2)
        expect(getMessages.mock.calls[0]?.[1]).toEqual({ limit: 200 })
        expect(getMessages.mock.calls[1]?.[1]).toEqual({ beforeAt: 10_000, beforeSeq: 101, limit: 200 })
        expect(getMessageWindowState(id).messages.map((message) => message.id)).toEqual([
            'user-1',
            'agent-1',
            'user-2',
            'agent-2',
            ...traceRows.map((message) => message.id)
        ])
        expect(getMessageWindowState(id).hasMore).toBe(true)
        expect(oldestCursorAt(id)).toBe(97)
    })
})

describe('history view and older pagination', () => {
    it('keeps the real final answer while backfilling a record-dense response', async () => {
        const id = sessionId('oversized-response-final')
        // 1000 stream records for a single agent run: two conversation units
        // overall, so the unit budgets keep every record reachable even
        // though the old record-count window would have dropped most of it.
        const agentRows = Array.from({ length: 1_000 }, (_, index) => {
            const seq = index + 2
            return makeAgentMessage({
                id: seq === 1_001 ? 'real-final-answer' : `work-${seq}`,
                seq,
                at: seq
            })
        })
        const pages = [
            agentRows.slice(800),
            agentRows.slice(600, 800),
            agentRows.slice(400, 600),
            agentRows.slice(200, 400),
            [
                makeUserMessage({ id: 'original-prompt', seq: 1, invokedAt: 1, createdAt: 1 }),
                ...agentRows.slice(0, 200)
            ]
        ]
        const getMessages = vi.fn()
            .mockResolvedValueOnce(latestResponse(pages[0]!, {
                epoch: 1,
                hasMore: true,
                nextBeforeAt: 802,
                nextBeforeSeq: 802
            }))
        for (let index = 1; index < pages.length; index += 1) {
            const page = pages[index]!
            const oldest = page[0]!
            getMessages.mockResolvedValueOnce(beforeResponse(page, {
                epoch: 1,
                hasMore: index < pages.length - 1,
                nextBeforeAt: oldest.invokedAt ?? oldest.createdAt,
                nextBeforeSeq: oldest.seq!
            }))
        }

        const api = createApi(getMessages)
        await syncTailMessages(api, id)

        expect(getMessages).toHaveBeenCalledTimes(5)
        expect(getMessages.mock.calls[0]?.[1]).toEqual({ limit: 200 })
        expect(getMessages.mock.calls[1]?.[1]).toEqual({ beforeAt: 802, beforeSeq: 802, limit: 200 })
        expect(getMessages.mock.calls[4]?.[1]).toEqual({ beforeAt: 202, beforeSeq: 202, limit: 200 })

        const state = getMessageWindowState(id)
        expect(state.messages).toHaveLength(1_001)
        expect(state.messages.some((message) => message.id === 'original-prompt')).toBe(true)
        expect(state.messages.some((message) => message.id === 'real-final-answer')).toBe(true)
        expect(state.messages.some((message) => message.id === 'work-900')).toBe(true)
    })

    it('appends while reading history, then compacts at the tail', () => {
        const id = sessionId('history-unseen')
        const initial = Array.from({ length: 60 }, (_, index) =>
            makeExchange(index + 1, index * 2 + 1)
        ).flat()
        ingestIncomingMessages(id, initial)
        setMessageViewMode(id, 'history')

        ingestIncomingMessages(id, makeExchange(61, 121))

        expect(getMessageWindowState(id).viewMode).toBe('history')
        expect(getMessageWindowState(id).messages.map((message) => message.id)).toContain('agent-61')

        setMessageViewMode(id, 'tail')
        const state = getMessageWindowState(id)
        expect(state.viewMode).toBe('tail')
        expect(state.messages).toHaveLength(120)
        expect(state.messages.at(-1)?.id).toBe('agent-61')
        expect(state.messages.some((message) => message.id === 'user-1')).toBe(false)
    })

    it('keeps rows dropped during tail compaction available to older pagination', async () => {
        const id = sessionId('tail-compaction-cursor')
        ingestIncomingMessages(id, Array.from({ length: 65 }, (_, index) =>
            makeExchange(index + 1, index * 2 + 1)
        ).flat())
        // 65 exchanges exceed the tail budget: the five oldest drop off and
        // the compaction cursor points at the oldest retained row.
        expect(getMessageWindowState(id).hasMore).toBe(true)
        expect(oldestCursorAt(id)).toBe(11)

        const getMessages = vi.fn(async () => beforeResponse(makeExchange(5, 9), {
            epoch: 0,
            hasMore: false,
            nextBeforeAt: 9,
            nextBeforeSeq: 9
        }))
        await fetchOlderMessages(createApi(getMessages), id)

        expect(getMessages).toHaveBeenCalledWith(id, {
            beforeAt: 11,
            beforeSeq: 11,
            limit: 200
        })
        const messages = getMessageWindowState(id).messages
        expect(messages.some((message) => message.id === 'user-5')).toBe(true)
        expect(messages).toHaveLength(122)
    })

    it('falls back to a latest request after the bounded history window overflows', async () => {
        const id = sessionId('history-overflow')
        const initial = makeAgentMessage({ id: 'initial', seq: 1, at: 1 })
        const getMessages = vi.fn()
            .mockResolvedValueOnce(latestResponse([initial], { epoch: 1 }))
            .mockResolvedValueOnce(latestResponse([
                makeAgentMessage({ id: 'latest', seq: 1_000, at: 1_000 })
            ], { epoch: 1 }))
        const api = createApi(getMessages)
        await syncTailMessages(api, id)
        setMessageViewMode(id, 'history')

        // 501 conversation units overflow the history budget: the oldest
        // units are kept, the window flags itself for a latest reset.
        ingestIncomingMessages(id, Array.from({ length: 250 }, (_, index) =>
            makeExchange(index + 1, index * 2 + 2)
        ).flat())
        expect(getMessageWindowState(id).messages).toHaveLength(240)

        setMessageViewMode(id, 'tail')
        await syncTailMessages(api, id)

        expect(getMessages.mock.calls[1]?.[1]).toEqual({ limit: 200 })
        expect(getMessageWindowState(id).messages.map((message) => message.id)).toContain('latest')
    })

    it('loads exactly one raw older page with the paired composite cursor', async () => {
        const id = sessionId('older-page')
        const latest = makeAgentMessage({ id: 'latest', seq: 10, at: 10_000 })
        const older = makeAgentMessage({ id: 'older', seq: 5, at: 5 })
        const getMessages = vi.fn()
            .mockResolvedValueOnce(latestResponse(coverageTail([latest], 6), {
                epoch: 4,
                hasMore: true,
                nextBeforeAt: 6,
                nextBeforeSeq: 6
            }))
            .mockResolvedValueOnce(beforeResponse([older], {
                epoch: 4,
                hasMore: false,
                nextBeforeAt: 5,
                nextBeforeSeq: 5
            }))
        const api = createApi(getMessages)
        await syncTailMessages(api, id)
        const outcome = await fetchOlderMessages(api, id)

        expect(outcome).toMatchObject({ kind: 'applied', historyVersion: 1 })
        expect(getMessages).toHaveBeenCalledTimes(2)
        expect(getMessages.mock.calls[1]?.[1]).toEqual({
            beforeAt: 6,
            beforeSeq: 6,
            limit: 200
        })
        expect(getMessageWindowState(id).messages.map((message) => message.id)).toEqual([
            'older',
            'user-1',
            'coverage-agent-1',
            'user-2',
            'coverage-agent-2',
            'latest'
        ])
    })

    it('advances the tail revision for live messages but not older-page loads', async () => {
        const id = sessionId('tail-revision')
        const latest = makeAgentMessage({ id: 'latest', seq: 10, at: 10_000 })
        const older = makeAgentMessage({ id: 'older', seq: 5, at: 5 })
        const getMessages = vi.fn()
            .mockResolvedValueOnce(latestResponse(coverageTail([latest], 6), {
                epoch: 4,
                hasMore: true,
                nextBeforeAt: 6,
                nextBeforeSeq: 6
            }))
            .mockResolvedValueOnce(beforeResponse([older], {
                epoch: 4,
                hasMore: false,
                nextBeforeAt: 5,
                nextBeforeSeq: 5
            }))
        const api = createApi(getMessages)

        await syncTailMessages(api, id)
        const afterTailSync = getMessageWindowState(id).tailRevision
        const outcome = await fetchOlderMessages(api, id)

        expect(outcome).toMatchObject({ kind: 'applied' })
        expect(getMessageWindowState(id).tailRevision).toBe(afterTailSync)

        ingestIncomingMessages(id, [
            makeAgentMessage({ id: 'new-live', seq: 11, at: 11_000 })
        ])

        expect(getMessageWindowState(id).tailRevision).toBe(afterTailSync + 1)
    })

    it('leaves the window unchanged when the final older-page apply check rejects', async () => {
        const id = sessionId('older-page-apply-rejected')
        const latest = makeAgentMessage({ id: 'latest', seq: 10, at: 10_000 })
        const older = makeAgentMessage({ id: 'older', seq: 5, at: 5 })
        const getMessages = vi.fn()
            .mockResolvedValueOnce(latestResponse(coverageTail([latest], 6), {
                epoch: 4,
                hasMore: true,
                nextBeforeAt: 6,
                nextBeforeSeq: 6
            }))
            .mockResolvedValueOnce(beforeResponse([older], {
                epoch: 4,
                hasMore: false,
                nextBeforeAt: 5,
                nextBeforeSeq: 5
            }))
        const api = createApi(getMessages)
        await syncTailMessages(api, id)
        const before = getMessageWindowState(id)

        const onBeforeApply = vi.fn(() => false)
        const outcome = await fetchOlderMessages(api, id, { onBeforeApply })

        expect(onBeforeApply).toHaveBeenCalledWith(before.historyVersion + 1)
        expect(outcome).toEqual({ kind: 'stopped', reason: 'invalidated' })
        expect(getMessageWindowState(id).messages.map((message) => message.id)).toEqual([
            ...coverageTail([], 6).map((message) => message.id),
            'latest'
        ])
        expect(getMessageWindowState(id)).toMatchObject({
            isLoadingMore: false,
            historyVersion: before.historyVersion
        })
    })

    it('advances through hidden older rows without retaining them in the visible window', async () => {
        const id = sessionId('hidden-older-page')
        const latest = makeAgentMessage({ id: 'latest', seq: 10, at: 10_000 })
        const hidden = makeHiddenAgentMessage({ id: 'hidden', seq: 5, at: 5 })
        const older = makeAgentMessage({ id: 'older', seq: 3, at: 3 })
        const getMessages = vi.fn()
            .mockResolvedValueOnce(latestResponse(coverageTail([latest], 6), {
                epoch: 4,
                hasMore: true,
                nextBeforeAt: 6,
                nextBeforeSeq: 6
            }))
            .mockResolvedValueOnce(beforeResponse([hidden], {
                epoch: 4,
                hasMore: true,
                nextBeforeAt: 4,
                nextBeforeSeq: 4
            }))
            .mockResolvedValueOnce(beforeResponse([older], {
                epoch: 4,
                hasMore: false,
                nextBeforeAt: 3,
                nextBeforeSeq: 3
            }))
        const api = createApi(getMessages)
        await syncTailMessages(api, id)

        // A page of only hidden rows adds no conversation unit, so the load
        // keeps paging (bounded) until something visible appears.
        const outcome = await fetchOlderMessages(api, id)
        expect(outcome).toMatchObject({
            kind: 'applied',
            addedRenderableCount: 1
        })
        expect(getMessages.mock.calls[1]?.[1]).toMatchObject({
            beforeAt: 6,
            beforeSeq: 6
        })
        expect(getMessages.mock.calls[2]?.[1]).toMatchObject({
            beforeAt: 4,
            beforeSeq: 4
        })
        expect(getMessageWindowState(id).messages.map((message) => message.id)).toEqual([
            'older',
            'user-1',
            'coverage-agent-1',
            'user-2',
            'coverage-agent-2',
            'latest'
        ])
    })

    it('discards an older response invalidated by a concurrent epoch reset', async () => {
        const id = sessionId('older-reset-race')
        const older = deferred<MessagesResponse>()
        const getMessages = vi.fn(async (_sessionId: string, options?: Parameters<ApiClient['getMessages']>[1]) => {
            if (options?.beforeAt !== undefined) {
                return await older.promise
            }
            if (options?.afterAt !== undefined) {
                return latestResponse([
                    makeAgentMessage({ id: 'fresh', seq: 20, at: 20_000 })
                ], { epoch: 2, reset: true })
            }
            return latestResponse(coverageTail([
                makeAgentMessage({ id: 'initial', seq: 10, at: 10_000 })
            ], 6), {
                epoch: 1,
                hasMore: true,
                nextBeforeAt: 6,
                nextBeforeSeq: 6
            })
        }) as ApiClient['getMessages']
        const api = createApi(getMessages)
        await syncTailMessages(api, id)

        const loadingOlder = fetchOlderMessages(api, id)
        await vi.waitFor(() => expect(getMessageWindowState(id).isLoadingMore).toBe(true))
        await syncTailMessages(api, id)
        expect(getMessageWindowState(id)).toMatchObject({
            epoch: 2,
            isLoadingMore: false
        })

        older.resolve(beforeResponse([
            makeAgentMessage({ id: 'stale-older', seq: 9, at: 9_000 })
        ], {
            epoch: 1,
            hasMore: false,
            nextBeforeAt: 9_000,
            nextBeforeSeq: 9
        }))
        expect(await loadingOlder).toEqual({ kind: 'stopped', reason: 'invalidated' })

        expect(getMessageWindowState(id).messages.map((message) => message.id)).toEqual(['fresh'])
        expect(getMessageWindowState(id).epoch).toBe(2)
    })

    it('treats an invalidated older request rejection as a stopped load', async () => {
        const id = sessionId('older-rejection-after-reset')
        const older = deferred<MessagesResponse>()
        const getMessages = vi.fn(async (_sessionId: string, options?: Parameters<ApiClient['getMessages']>[1]) => {
            if (options?.beforeAt !== undefined) {
                return await older.promise
            }
            if (options?.afterAt !== undefined) {
                return latestResponse([
                    makeAgentMessage({ id: 'fresh', seq: 20, at: 20_000 })
                ], { epoch: 2, reset: true })
            }
            return latestResponse(coverageTail([
                makeAgentMessage({ id: 'initial', seq: 10, at: 10_000 })
            ], 6), {
                epoch: 1,
                hasMore: true,
                nextBeforeAt: 6,
                nextBeforeSeq: 6
            })
        }) as ApiClient['getMessages']
        const api = createApi(getMessages)
        await syncTailMessages(api, id)

        const loadingOlder = fetchOlderMessages(api, id)
        await vi.waitFor(() => expect(getMessageWindowState(id).isLoadingMore).toBe(true))
        await syncTailMessages(api, id)

        older.reject(new Error('stale transport failure'))

        expect(await loadingOlder).toEqual({ kind: 'stopped', reason: 'invalidated' })
        expect(getMessageWindowState(id).warning).toBeNull()
        expect(getMessageWindowState(id).messages.map((message) => message.id)).toEqual(['fresh'])
    })

    it('rejects an older page that resolves after a reset request starts but before it applies', async () => {
        const id = sessionId('older-before-reset-response')
        const older = deferred<MessagesResponse>()
        const reset = deferred<MessagesResponse>()
        const getMessages = vi.fn(async (_sessionId: string, options?: Parameters<ApiClient['getMessages']>[1]) => {
            if (options?.beforeAt !== undefined) {
                return await older.promise
            }
            if (options?.afterAt !== undefined) {
                return await reset.promise
            }
            return latestResponse(coverageTail([
                makeAgentMessage({ id: 'initial', seq: 10, at: 10_000 })
            ], 6), {
                epoch: 1,
                hasMore: true,
                nextBeforeAt: 6,
                nextBeforeSeq: 6
            })
        }) as ApiClient['getMessages']
        const api = createApi(getMessages)
        await syncTailMessages(api, id)

        const loadingOlder = fetchOlderMessages(api, id)
        await vi.waitFor(() => expect(getMessageWindowState(id).isLoadingMore).toBe(true))
        const syncing = syncTailMessages(api, id)
        await vi.waitFor(() => expect(getMessages).toHaveBeenCalledTimes(3))

        older.resolve(beforeResponse([
            makeAgentMessage({ id: 'stale-older', seq: 5, at: 5 })
        ], {
            epoch: 1,
            hasMore: false,
            nextBeforeAt: 5,
            nextBeforeSeq: 5
        }))
        expect(await loadingOlder).toEqual({ kind: 'stopped', reason: 'invalidated' })
        expect(getMessageWindowState(id).messages.map((message) => message.id)).toEqual([
            'user-1',
            'coverage-agent-1',
            'user-2',
            'coverage-agent-2',
            'initial'
        ])

        reset.resolve(latestResponse([
            makeAgentMessage({ id: 'fresh', seq: 20, at: 20_000 })
        ], { epoch: 2, reset: true }))
        await syncing

        expect(getMessageWindowState(id).messages.map((message) => message.id)).toEqual(['fresh'])
        expect(getMessageWindowState(id).epoch).toBe(2)
    })

    it('restarts the tail sync when an older page discovers a new epoch', async () => {
        const id = sessionId('older-epoch-mismatch')
        const getMessages = vi.fn()
            .mockResolvedValueOnce(latestResponse(coverageTail([
                makeAgentMessage({ id: 'initial', seq: 12, at: 10_000 })
            ], 8), {
                epoch: 1,
                hasMore: true,
                nextBeforeAt: 8,
                nextBeforeSeq: 8
            }))
            .mockResolvedValueOnce(beforeResponse([], {
                epoch: 2,
                hasMore: false,
                nextBeforeAt: null,
                nextBeforeSeq: null
            }))
            .mockResolvedValueOnce(latestResponse([
                makeAgentMessage({ id: 'fresh', seq: 20, at: 20_000 })
            ], { epoch: 2 }))
        const api = createApi(getMessages)
        await syncTailMessages(api, id)

        const loadedOlderPage = await fetchOlderMessages(api, id)

        expect(loadedOlderPage).toEqual({ kind: 'stopped', reason: 'epoch-reset' })
        expect(getMessageWindowState(id).messages.map((message) => message.id)).toEqual(['fresh'])
        expect(getMessageWindowState(id).epoch).toBe(2)
    })

    it('protects regular conversation rows from an agent-run flood', () => {
        const id = sessionId('agent-run-budget')
        const root = makeUserMessage({ id: 'root', seq: 1, invokedAt: 1, createdAt: 1 })
        ingestIncomingMessages(id, [
            root,
            ...Array.from({ length: 801 }, (_, index) =>
                makeAgentRunMessage(`run-${index}`, index + 2, index + 2)
            )
        ])

        const kept = getMessageWindowState(id).messages
        // Agent-run cards have their own record budget: past it the oldest
        // cards drop, while the conversation row survives regardless.
        expect(kept.some((message) => message.id === 'root')).toBe(true)
        expect(kept.some((message) => message.id === 'run-800')).toBe(true)
        expect(kept.some((message) => message.id === 'run-0')).toBe(false)
    })
})

describe('optimistic and queued-message operations', () => {
    it('replaces an optimistic row by localId and updates status in the canonical collection', () => {
        const id = sessionId('optimistic-replace')
        appendOptimisticMessage(id, makeUserMessage({
            id: 'local-1',
            localId: 'local-1',
            invokedAt: null,
            status: 'sending'
        }))
        ingestIncomingMessages(id, [makeUserMessage({
            id: 'server-1',
            seq: 1,
            localId: 'local-1',
            invokedAt: null
        })])
        updateMessageStatus(id, 'local-1', 'sent')

        expect(getMessageWindowState(id).messages).toHaveLength(1)
        expect(getMessageWindowState(id).messages[0]).toMatchObject({
            id: 'server-1',
            status: 'sent'
        })
    })

    it('marks queued rows consumed and reorders them by invoked position', () => {
        const id = sessionId('consumed')
        ingestIncomingMessages(id, [
            makeUserMessage({
                id: 'queued',
                seq: 1,
                localId: 'local-1',
                createdAt: 1_000,
                invokedAt: null,
                status: 'queued'
            }),
            makeAgentMessage({ id: 'agent', seq: 2, at: 2_000 })
        ])

        const beforeConsumed = getMessageWindowState(id).tailRevision
        markMessagesConsumed(id, ['local-1'], 3_000)

        expect(getMessageWindowState(id).messages.at(-1)).toMatchObject({
            id: 'queued',
            status: 'sent',
            invokedAt: 3_000
        })
        expect(getMessageWindowState(id).tailRevision).toBe(beforeConsumed + 1)
    })

    it('reconciles queued candidates without a secondary pending collection', () => {
        const id = sessionId('queued-reconcile')
        ingestIncomingMessages(id, [
            makeUserMessage({ id: 'stale', seq: 1, localId: 'local-stale', invokedAt: null }),
            makeUserMessage({ id: 'queued', seq: 2, localId: 'local-queued', invokedAt: null }),
            makeUserMessage({
                id: 'local-optimistic',
                localId: 'local-optimistic',
                invokedAt: null,
                status: 'sending'
            })
        ])
        updateMessageStatus(id, 'local-optimistic', 'queued')

        expect(new Set(getQueuedReconcileCandidateLocalIds(id))).toEqual(new Set([
            'local-stale',
            'local-queued',
            'local-optimistic'
        ]))
        reconcileQueuedLocalIds(
            id,
            ['local-stale', 'local-queued', 'local-optimistic'],
            ['local-queued']
        )

        expect(getMessageWindowState(id).messages.map((message) => message.id)).toEqual(['queued'])
    })

    it('removes a queued or optimistic row by localId idempotently', () => {
        const id = sessionId('remove')
        appendOptimisticMessage(id, makeUserMessage({
            id: 'local-1',
            localId: 'local-1',
            invokedAt: null,
            status: 'queued'
        }))

        removeOptimisticMessage(id, 'local-1')
        removeOptimisticMessage(id, 'local-1')

        expect(getMessageWindowState(id).messages).toEqual([])
    })
})

describe('V2 persistence boundary', () => {
    it('ignores the V1 pending-buffer state entirely', () => {
        const id = sessionId('ignore-v1')
        sessionStorage.setItem(`hapi:message-window:v1:${id}`, JSON.stringify({
            messages: [makeAgentMessage({ id: 'legacy', seq: 1, at: 1 })],
            pending: []
        }))

        expect(getMessageWindowState(id).messages).toEqual([])
    })

    it('hydrates V2 sending rows as queued reconciliation candidates', () => {
        const id = sessionId('hydrate-sending')
        sessionStorage.setItem(`hapi:message-window:v2:${id}`, JSON.stringify({
            messages: [makeUserMessage({
                id: 'local-1',
                localId: 'local-1',
                invokedAt: null,
                status: 'sending'
            })],
            hasMore: false,
            oldestPositionAt: null,
            oldestPositionSeq: null,
            newestPositionAt: null,
            newestPositionSeq: null,
            epoch: null
        }))

        expect(getMessageWindowState(id).messages[0]?.status).toBe('queued')
        expect(getQueuedReconcileCandidateLocalIds(id)).toEqual(['local-1'])
    })
})


describe('reasoning snapshot compaction', () => {
    it('keeps only the newest snapshot of each stream', () => {
        const id = sessionId('reasoning-compaction')
        const snapshots = Array.from({ length: 5 }, (_, index) =>
            makeReasoningMessage(`snap-${index}`, 'stream-1', index + 1, index + 1)
        )
        const others = [
            makeUserMessage({ id: 'user-1', seq: 10, invokedAt: 10, createdAt: 10 }),
            makeUserMessage({ id: 'user-2', seq: 11, invokedAt: 11, createdAt: 11 })
        ]
        ingestIncomingMessages(id, [...snapshots, ...others])

        expect(getMessageWindowState(id).messages.map((message) => message.id))
            .toEqual(['snap-4', 'user-1', 'user-2'])
    })

    it('keeps the newest snapshot of every stream independently', () => {
        const id = sessionId('reasoning-multi-stream')
        ingestIncomingMessages(id, [
            makeReasoningMessage('a-1', 'stream-a', 1, 1),
            makeReasoningMessage('a-2', 'stream-a', 2, 2),
            makeReasoningMessage('b-1', 'stream-b', 3, 3),
            makeReasoningMessage('b-2', 'stream-b', 4, 4)
        ])

        expect(getMessageWindowState(id).messages.map((message) => message.id)).toEqual(['a-2', 'b-2'])
    })

    it('leaves messages without a reasoning stream untouched', () => {
        const id = sessionId('reasoning-unrelated')
        const messages = [
            makeUserMessage({ id: 'user-1', seq: 1, invokedAt: 1, createdAt: 1 }),
            makeAgentRunMessage('run-1', 2, 2),
            makeAgentRunMessage('run-2', 3, 3)
        ]
        ingestIncomingMessages(id, messages)

        expect(getMessageWindowState(id).messages).toHaveLength(3)
    })

    it('spends the window budget on conversation rather than duplicate snapshots', () => {
        const id = sessionId('reasoning-window-budget')
        // A session already carrying a flood of stored snapshots: without
        // compaction they would be paged in as records and crowd out the
        // conversation that surrounds them.
        const flood = Array.from({ length: 200 }, (_, index) =>
            makeReasoningMessage(`flood-${index}`, 'stream-1', index + 1, index + 1)
        )
        const conversation = Array.from({ length: 50 }, (_, index) =>
            makeUserMessage({
                id: `talk-${index}`,
                seq: TAIL_UNIT_BUDGET + index + 1,
                invokedAt: TAIL_UNIT_BUDGET + index + 1,
                createdAt: TAIL_UNIT_BUDGET + index + 1
            })
        )
        ingestIncomingMessages(id, [...flood, ...conversation])

        const kept = getMessageWindowState(id).messages
        for (const message of conversation) {
            expect(kept.some((candidate) => candidate.id === message.id)).toBe(true)
        }
        expect(kept.filter((message) => message.id.startsWith('flood-'))).toHaveLength(1)
    })

    // The seq bounds are a view over what the window currently holds; the
    // cursor that drives older-page requests is the server's own
    // `nextBefore*`, which compaction never touches. Pinning the bounds keeps
    // that distinction honest if the two are ever conflated.
    it('derives its seq bounds from the surviving rows', () => {
        const id = sessionId('reasoning-bounds')
        ingestIncomingMessages(id, [
            makeReasoningMessage('snap-1', 'stream-1', 1, 1),
            makeReasoningMessage('snap-2', 'stream-1', 2, 2),
            makeUserMessage({ id: 'user-1', seq: 3, invokedAt: 3, createdAt: 3 })
        ])

        const state = getMessageWindowState(id)
        expect(state.oldestSeq).toBe(2)
        expect(state.newestSeq).toBe(3)
    })
})
