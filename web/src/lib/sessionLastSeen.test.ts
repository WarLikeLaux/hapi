import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import {
    configureSessionReadState, flushSessionReadState, getSessionLastSeenAt,
    getSessionManualUnreadAt, getUnreadSessionCount, markAllSessionsSeen,
    markSessionSeen, markSessionUnread, observeSessionReadStates,
    useSessionLastSeenVersion,
} from './sessionLastSeen'
import type { SessionReadState, SessionReadStateRequest } from '@hapi/protocol'

const server = (readRevision = 0, version = 0, manualUnread = false): SessionReadState => ({ readRevision, version, manualUnread })
const dormant = () => Promise.reject(new Error('offline'))
let cleanup = () => {}
function offlineScope(scope: string) { cleanup(); cleanup = configureSessionReadState(scope, dormant); cleanup() }

beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
    offlineScope('hub-a:alice')
})
afterEach(async () => { cleanup(); await vi.advanceTimersByTimeAsync(0); vi.useRealTimers(); vi.restoreAllMocks() })

describe('durable session read state', () => {
    it('ignores legacy timestamps and metadata-only changes', () => {
        localStorage.setItem('hapi.sessionLastSeen.v1', JSON.stringify({ s: Date.now() }))
        expect(getSessionLastSeenAt('s')).toBe(0)
        expect(getUnreadSessionCount([{ id: 's', contentRevision: 0 }])).toBe(0)
        expect(getUnreadSessionCount([{ id: 's', contentRevision: 1 }])).toBe(1)
    })

    it('persists the exact observed revision monotonically and scopes by hub and namespace', () => {
        markSessionSeen('s', 3)
        markSessionSeen('s', 1)
        expect(getSessionLastSeenAt('s')).toBe(3)
        offlineScope('hub-a:bob')
        expect(getSessionLastSeenAt('s')).toBe(0)
        offlineScope('hub-b:alice')
        expect(getSessionLastSeenAt('s')).toBe(0)
        offlineScope('hub-a:alice')
        expect(getSessionLastSeenAt('s')).toBe(3)
        expect(getUnreadSessionCount([{ id: 's', contentRevision: 4 }])).toBe(1)
    })

    it('merges reads from other clients without allowing a stale response to erase manual unread', () => {
        observeSessionReadStates([{ id: 's', readState: server(3, 2, true) }])
        observeSessionReadStates([{ id: 's', readState: server(2, 1) }])
        markSessionSeen('s', 3, 1)
        expect(getSessionManualUnreadAt('s')).toBe(0)
        markSessionSeen('s', 3, 2)
        expect(getSessionManualUnreadAt('s')).toBeNull()
        expect(getUnreadSessionCount([{ id: 's', contentRevision: 3, readState: server(3, 3, true) }])).toBe(1)
    })

    it('retains running content in bulk unread state and preserves manual unread', () => {
        const row = { id: 's', contentRevision: 2, active: true, thinking: true }
        expect(getUnreadSessionCount([row])).toBe(1)
        expect(getUnreadSessionCount([{ ...row, active: false }])).toBe(1)
        markSessionUnread('s')
        expect(getUnreadSessionCount([row])).toBe(1)
        expect(markAllSessionsSeen([row])).toBe(1)
        expect(getSessionLastSeenAt('s')).toBe(2)
    })

    it('does not claim a read when durable storage fails', () => {
        markSessionSeen('s', 1)
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
        markSessionSeen('s', 3)
        expect(getSessionLastSeenAt('s')).toBe(1)
    })

    it('retries the persisted operation and preserves a newer operation during acknowledgement', async () => {
        markSessionSeen('s', 3)
        let resolve!: (value: { readState: SessionReadState }) => void
        const sent: SessionReadStateRequest[] = []
        cleanup = configureSessionReadState('hub-a:alice', async (_id, request) => {
            sent.push({ ...request })
            if (sent.length === 1) return new Promise(r => { resolve = r })
            return { readState: server(request.type === 'read' ? request.readRevision : 0, 2) }
        })
        markSessionSeen('s', 4)
        resolve({ readState: server(3, 1) })
        await vi.advanceTimersByTimeAsync(0)
        await flushSessionReadState()
        expect(sent.map(r => r.type === 'read' ? r.readRevision : null)).toEqual([3, 4])
        expect(getSessionLastSeenAt('s')).toBe(4)
        expect(JSON.parse(localStorage.getItem('hapi.sessionReadState.v1:hub-a:alice')!).s.pending).toBeUndefined()
    })

    it('rolls back a rejected operation to authoritative state', async () => {
        markSessionSeen('s', 9)
        cleanup = configureSessionReadState('hub-a:alice', async () => {
            throw { status: 409, body: JSON.stringify({ readState: server(2, 3, true) }) }
        })
        await vi.advanceTimersByTimeAsync(0)
        expect(getSessionLastSeenAt('s')).toBe(2)
        expect(getSessionManualUnreadAt('s')).toBe(0)
    })

    it('retains the pending read when saving a rejected response fails', async () => {
        markSessionSeen('s', 9)
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
        cleanup = configureSessionReadState('hub-a:alice', async () => {
            throw { status: 409, body: JSON.stringify({ readState: server(2, 3, true) }) }
        })
        await vi.advanceTimersByTimeAsync(0)
        expect(getSessionLastSeenAt('s')).toBe(9)
        expect(getSessionManualUnreadAt('s')).toBeNull()
    })
})

describe('legacy migration', () => {
    it.each([
        { name: 'manual unread', seen: 300, manual: 300, activity: 300, unread: true },
        { name: 'unseen old output', seen: 100, activity: 300, unread: true },
        { name: 'previously read', seen: 300, activity: 300, unread: false },
        { name: 'new browser baseline', activity: 300, unread: false },
        { name: 'unapplied close receipt', seen: 100, manual: 100, activity: 300, readThrough: 400, unread: false },
        { name: 'later local manual choice', seen: 100, manual: 100, activity: 300, readThrough: 400, applied: 400, unread: true },
        { name: 'newer shared read wins', seen: 100, manual: 100, activity: 300, version: 2, unread: false },
    ])('preserves $name without treating timestamps as revisions', data => {
        if (data.seen !== undefined) localStorage.setItem('hapi.sessionLastSeen.v1', JSON.stringify({ s: data.seen }))
        if (data.manual !== undefined) localStorage.setItem('hapi.sessionManualUnread.v1', JSON.stringify({ s: data.manual }))
        if (data.applied !== undefined) localStorage.setItem('hapi.sessionAppliedRead.v1:old-hub', JSON.stringify({ s: data.applied }))
        observeSessionReadStates([{ id: 's', lastAgentMessageAt: data.activity, contentRevision: 0,
            metadata: { readThrough: data.readThrough }, readState: server(0, data.version ?? 0) }], 'old-hub')
        expect(getUnreadSessionCount([{ id: 's', contentRevision: 0 }])).toBe(Number(data.unread))
        expect(getSessionLastSeenAt('s')).toBe(0)
    })

    it('imports only authenticated session IDs once and retains old data for rollback', () => {
        const legacy = JSON.stringify({ s: 100, foreign: 100 })
        localStorage.setItem('hapi.sessionManualUnread.v1', legacy)
        const rows = [{ id: 's', readState: server(), contentRevision: 0 }]
        observeSessionReadStates(rows, 'old-hub')
        expect(getSessionManualUnreadAt('s')).toBe(0)
        expect(getSessionManualUnreadAt('foreign')).toBeNull()
        markSessionSeen('s', 0, 0)
        observeSessionReadStates(rows, 'old-hub')
        expect(getSessionManualUnreadAt('s')).toBeNull()
        expect(localStorage.getItem('hapi.sessionManualUnread.v1')).toBe(legacy)
    })
})

it('marks duplicate, generating and manual rows in one bulk write while excluding muted rows', () => {
    markSessionSeen('read', 2)
    markSessionUnread('muted')
    const rows = [
        { id: 'read', contentRevision: 2 },
        { id: 'working', contentRevision: 4, active: true, thinking: true },
        { id: 'working', contentRevision: 3, active: true, thinking: true },
        { id: 'muted', contentRevision: 7, metadata: { muted: true } },
    ]
    expect(getUnreadSessionCount(rows)).toBe(1)
    expect(markAllSessionsSeen(rows)).toBe(1)
    expect(getSessionLastSeenAt('working')).toBe(4)
    expect(getUnreadSessionCount(rows)).toBe(0)
    expect(getSessionManualUnreadAt('muted')).toBe(0)
})

it('updates a subscribed consumer only for another tab in the same read-state scope', () => {
    const { result } = renderHook(() => {
        useSessionLastSeenVersion()
        return getSessionManualUnreadAt('s')
    })
    const key = 'hapi.sessionReadState.v1:hub-a:alice'
    localStorage.setItem(key, JSON.stringify({ s: { server: server(0, 1, true) } }))
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: 'hapi.sessionReadState.v1:hub-b:alice' })))
    expect(result.current).toBeNull()
    act(() => window.dispatchEvent(new StorageEvent('storage', { key })))
    expect(result.current).toBe(0)
})

it('refreshes read state changed by another tab even without mounted subscribers', () => {
    const key = 'hapi.sessionReadState.v1:hub-a:alice'
    expect(getSessionManualUnreadAt('s')).toBeNull()
    localStorage.setItem(key, JSON.stringify({ s: { server: server(3, 2, true) } }))
    window.dispatchEvent(new StorageEvent('storage', { key }))
    expect(getSessionManualUnreadAt('s')).toBe(0)
    expect(getSessionLastSeenAt('s')).toBe(3)
})

it('refreshes another tab’s manual choice before deciding a read is redundant', () => {
    const key = 'hapi.sessionReadState.v1:hub-a:alice'
    observeSessionReadStates([{ id: 's', readState: server(3, 1) }])
    expect(getSessionManualUnreadAt('s')).toBeNull()
    localStorage.setItem(key, JSON.stringify({ s: { server: server(3, 2, true) } }))
    markSessionSeen('s', 3)
    expect(getSessionManualUnreadAt('s')).toBeNull()
    expect(JSON.parse(localStorage.getItem(key)!).s.pending.request.expectedVersion).toBe(2)
})

it('keeps the read-state API usable when browser storage is denied', () => {
    const descriptor = Object.getOwnPropertyDescriptor(window, 'localStorage')!
    Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new Error('denied') } })
    try {
        expect(getSessionLastSeenAt('s')).toBe(0)
        expect(() => markSessionSeen('s', 3)).not.toThrow()
    } finally { Object.defineProperty(window, 'localStorage', descriptor) }
})
