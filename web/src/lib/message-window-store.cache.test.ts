import { afterEach, expect, it, vi } from 'vitest'
import { ApiClient } from '@/api/client'
import type { DecryptedMessage, MessagesResponse } from '@/types/api'
import {
    clearMessageWindow,
    appendOptimisticMessage,
    fetchOlderMessages,
    getMessageWindowState,
    ingestIncomingMessages,
    removeOptimisticMessage,
    setMessageViewMode,
    subscribeMessageWindow,
    syncTailMessages,
} from '@/lib/message-window-store'

const ids = ['warm-dense', 'warm-history', 'warm-complete', 'warm-persisted', 'hung-read']

function row(seq: number, role: 'user' | 'agent', text = `message ${seq}`): DecryptedMessage {
    return {
        id: `row-${seq}`, seq, localId: null, createdAt: seq, invokedAt: seq,
        content: role === 'user'
            ? { role, content: { type: 'text', text } }
            : { role, content: { type: 'codex', data: { type: 'message', message: text } } },
    } as DecryptedMessage
}

function response(messages: DecryptedMessage[], direction: 'latest' | 'before' = 'latest'): MessagesResponse {
    return {
        messages,
        page: {
            direction, limit: 200, epoch: 1, reset: false, hasMore: false,
            nextBeforeAt: messages[0]?.createdAt ?? null,
            nextBeforeSeq: messages[0]?.seq ?? null,
            nextAfterAt: null, nextAfterSeq: null,
            snapshotHeadAt: messages.at(-1)?.createdAt ?? null,
            snapshotHeadSeq: messages.at(-1)?.seq ?? null,
        },
    }
}

afterEach(async () => {
    for (const id of ids) clearMessageWindow(id)
    if (vi.isFakeTimers()) await vi.runOnlyPendingTimersAsync()
    sessionStorage.clear()
    vi.useRealTimers()
    vi.unstubAllGlobals()
})

it('keeps the complete latest answer in a small reload cache while releasing inactive raw history', async () => {
    vi.useFakeTimers()
    const unsubscribe = subscribeMessageWindow('warm-dense', () => {})
    const text = 'Полный последний ответ. '.repeat(3000)
    const records = [row(1, 'user'), ...Array.from({ length: 3000 }, (_, index) => row(index + 2, 'agent', 'x'.repeat(2048))), row(3002, 'agent', text)]
    ingestIncomingMessages('warm-dense', records)
    await vi.advanceTimersByTimeAsync(250)
    const raw = sessionStorage.getItem('hapi:message-window:v3:warm-dense')!
    expect(raw.length).toBeLessThan(512 * 1024)
    expect(JSON.parse(raw).messages.at(-1)).toEqual(records.at(-1))
    // Partial raw coverage must trigger a full reconciliation after reload.
    expect(JSON.parse(raw).newestPositionSeq).toBeNull()
    unsubscribe()
    await vi.advanceTimersByTimeAsync(250)
    expect(getMessageWindowState('warm-dense').messages.length).toBeLessThan(10)

    vi.resetModules()
    const reloaded = await import('@/lib/message-window-store')
    expect(reloaded.getMessageWindowState('warm-dense').messages.at(-1)).toEqual(records.at(-1))
    reloaded.clearMessageWindow('warm-dense')
})

it('retains the latest cached answer when an inactive reader had paged away from the tail', async () => {
    vi.useFakeTimers()
    const unsubscribe = subscribeMessageWindow('warm-history', () => {})
    const latest = row(1001, 'agent', 'The latest answer must open immediately')
    ingestIncomingMessages('warm-history', [row(1000, 'user'), latest])
    setMessageViewMode('warm-history', 'history')
    const old = Array.from({ length: 300 }, (_, index) => row(index + 1, 'user'))
    ingestIncomingMessages('warm-history', old)
    expect(getMessageWindowState('warm-history').messages.some(message => message.id === latest.id)).toBe(false)
    const queued = { ...row(1002, 'user'), localId: 'queued', invokedAt: null, status: 'queued' as const }
    appendOptimisticMessage('warm-history', queued)
    removeOptimisticMessage('warm-history', 'queued')
    const newer = row(1003, 'agent', 'New response received while browsing history')
    ingestIncomingMessages('warm-history', [newer])
    unsubscribe()
    await vi.advanceTimersByTimeAsync(250)
    const idle = getMessageWindowState('warm-history').messages
    expect(idle).toContainEqual(latest)
    expect(idle.at(-1)).toEqual(newer)
    expect(idle.some(message => message.localId === 'queued')).toBe(false)
    expect(JSON.parse(sessionStorage.getItem('hapi:message-window:v3:warm-history')!).messages.at(-1)).toEqual(newer)
})

it('flushes the complete latest answer on page exit even when it exceeds the soft cache budget', () => {
    vi.useFakeTimers()
    const answer = row(2, 'agent', 'Long complete answer. '.repeat(30_000))
    ingestIncomingMessages('warm-complete', [row(1, 'user'), answer])
    window.dispatchEvent(new Event('pagehide'))
    const persisted = JSON.parse(sessionStorage.getItem('hapi:message-window:v3:warm-complete')!)
    expect(persisted.messages).toEqual([row(1, 'user'), answer])
})

it('updates a hydrated partial cache with the first background response before the chat is opened', () => {
    vi.useFakeTimers()
    sessionStorage.setItem('hapi:message-window:v3:warm-persisted', JSON.stringify({
        messages: [row(1, 'user'), row(2, 'agent')], hasMore: true, epoch: 1,
        oldestPositionAt: 1, oldestPositionSeq: 1,
        newestPositionAt: null, newestPositionSeq: null,
    }))
    const answer = row(3, 'agent', 'Fresh background answer')
    ingestIncomingMessages('warm-persisted', [answer])
    window.dispatchEvent(new Event('pagehide'))
    expect(JSON.parse(sessionStorage.getItem('hapi:message-window:v3:warm-persisted')!).messages.at(-1)).toEqual(answer)
})

it('releases a hung history read so older loading and a fresh synchronization can proceed', async () => {
    vi.useFakeTimers()
    const cached = [row(1, 'user'), row(2, 'agent'), row(3, 'user'), row(4, 'agent')]
    sessionStorage.setItem('hapi:message-window:v3:hung-read', JSON.stringify({
        messages: cached, hasMore: true, epoch: 1,
        oldestPositionAt: 1, oldestPositionSeq: 1,
        newestPositionAt: 4, newestPositionSeq: 4,
    }))
    let resolveLate!: (value: Response) => void
    const fetchMock = vi.fn()
        .mockImplementationOnce(() => new Promise<Response>(resolve => { resolveLate = resolve }))
        .mockResolvedValueOnce(new Response(JSON.stringify(response([], 'before'))))
        .mockResolvedValueOnce(new Response(JSON.stringify(response([...cached, row(5, 'agent')]))))
    vi.stubGlobal('fetch', fetchMock)
    const api = new ApiClient('test-token')
    let settled = false
    const syncing = syncTailMessages(api, 'hung-read').then(() => { settled = true })
    await vi.advanceTimersByTimeAsync(31_000)
    expect(settled).toBe(true)
    await syncing
    expect(getMessageWindowState('hung-read').isSyncingTail).toBe(false)
    expect(getMessageWindowState('hung-read').messages).toEqual(cached)
    expect((await fetchOlderMessages(api, 'hung-read')).kind).toBe('applied')
    await syncTailMessages(api, 'hung-read')
    expect(getMessageWindowState('hung-read').messages.at(-1)?.id).toBe('row-5')
    // A fetch implementation that ignores abort must not apply a late stale result.
    resolveLate(new Response(JSON.stringify(response([row(99, 'agent')]))))
    await vi.advanceTimersByTimeAsync(1)
    expect(getMessageWindowState('hung-read').messages.at(-1)?.id).toBe('row-5')
})
