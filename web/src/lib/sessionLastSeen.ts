import { useSyncExternalStore } from 'react'
import { EMPTY_READ_STATE, mergeReadState, type SessionReadState, type SessionReadStateRequest } from '@hapi/protocol'

type SessionInput = {
    id: string; contentRevision?: number; readState?: SessionReadState; active?: boolean; thinking?: boolean
    lastAgentMessageAt?: number; updatedAt?: number
    metadata?: { muted?: boolean; readThrough?: number } | null
}
type Pending = { id: string; request: SessionReadStateRequest }
type Entry = { server: SessionReadState; pending?: Pending; legacyMigrated?: boolean }
type Store = Record<string, Entry>
type Sender = (id: string, request: SessionReadStateRequest) => Promise<{ readState: SessionReadState }>
const CHANGE_EVENT = 'hapi.sessionReadState.changed'
const PREFIX = 'hapi.sessionReadState.v1:'
let scope = 'unconfigured'
let sender: Sender | null = null
let changeVersion = 0
let running = false
let retry: ReturnType<typeof setTimeout> | undefined

function readStore(key = scope): Store {
    try {
        const value: unknown = JSON.parse(localStorage.getItem(PREFIX + key) ?? '{}')
        return value && typeof value === 'object' && !Array.isArray(value) ? value as Store : {}
    } catch { return {} }
}
function save(store: Store, key = scope): boolean {
    try { localStorage.setItem(PREFIX + key, JSON.stringify(store)); return true } catch { return false }
}
function notify(): void {
    changeVersion += 1
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(CHANGE_EVENT))
}
function effective(entry?: Entry, incoming?: SessionReadState): SessionReadState {
    const pending = entry?.pending?.request
    const state = mergeReadState(entry?.server, incoming) ?? EMPTY_READ_STATE
    if (!pending) return state
    return {
        ...state,
        readRevision: pending.type === 'read' ? Math.max(state.readRevision, pending.readRevision) : state.readRevision,
        manualUnread: pending.expectedVersion === state.version ? pending.type === 'unread' : state.manualUnread
    }
}

/** Scope includes the authenticated namespace; never re-use another hub's outbox. */
export function configureSessionReadState(key: string, send: Sender): () => void {
    scope = key
    sender = send
    notify()
    void flushSessionReadState()
    const retryNow = () => { void flushSessionReadState() }
    window.addEventListener('online', retryNow)
    window.addEventListener('focus', retryNow)
    return () => {
        window.removeEventListener('online', retryNow)
        window.removeEventListener('focus', retryNow)
        if (sender === send) { sender = null; clearTimeout(retry) }
    }
}

/** Durable operations survive refresh/offline. A stale request is never rebased
 * onto a newer manual choice; only a new viewing action can clear that choice. */
export async function flushSessionReadState(): Promise<void> {
    if (running || !sender) return
    running = true
    const key = scope
    const send = sender
    let failed = false
    try {
        for (const [id, entry] of Object.entries(readStore(key))) {
            const pending = entry.pending
            if (!pending || sender !== send || scope !== key) continue
            try {
                const response = await send(id, pending.request)
                const store = readStore(key)
                const current = store[id] ?? entry
                current.server = mergeReadState(current.server, response.readState)!
                if (current.pending?.id === pending.id) delete current.pending
                else if (current.pending?.request.expectedVersion === pending.request.expectedVersion
                    && response.readState.version <= pending.request.expectedVersion + 1
                    && response.readState.manualUnread === (pending.request.type === 'unread')) {
                    // A newer local intent follows our own acknowledged write.
                    // Do not rebase across another client's manual-unread change.
                    current.pending.request.expectedVersion = response.readState.version
                }
                store[id] = current
                if (!save(store, key)) failed = true
                if (scope === key) notify()
            } catch (error) {
                const failure = error as { status?: number; body?: string }
                if ([400, 403, 404, 409].includes(failure.status ?? 0)) {
                    const store = readStore(key)
                    const current = store[id]
                    if (current?.pending?.id === pending.id) {
                        // 409 includes the authoritative manual choice.
                        try {
                            const body = JSON.parse(failure.body ?? '{}') as { readState?: SessionReadState }
                            current.server = mergeReadState(current.server, body.readState)!
                        } catch { /* a removed/replaced session has no read state */ }
                        delete current.pending
                        if (!save(store, key)) failed = true
                        if (scope === key) notify()
                    }
                } else { failed = true; break }
            }
        }
    } finally {
        running = false
        clearTimeout(retry)
        if (Object.values(readStore()).some(entry => entry.pending)) {
            retry = setTimeout(() => { void flushSessionReadState() }, failed ? 5_000 : 0)
        }
    }
}

export function observeSessionReadStates(sessions: Iterable<SessionInput>, legacyScope?: string): void {
    if (scope === 'unconfigured') return
    const store = readStore()
    const legacy = legacyScope === undefined ? undefined : readLegacyReadState(legacyScope)
    let changed = false
    let migratedUnread = false
    for (const session of sessions) {
        if (!session.readState) continue
        const current = store[session.id]
        const server = mergeReadState(current?.server, session.readState)!
        const entry: Entry = { ...current, server }
        if (legacy && !entry.legacyMigrated) {
            entry.legacyMigrated = true
            // Shared choices made after the upgrade take precedence over an old
            // browser coming online. Never rebase an old mark over that choice.
            if (server.version === 0 && !entry.pending && legacyIsUnread(session, legacy)) {
                entry.pending = { id: crypto.randomUUID(), request: { type: 'unread', expectedVersion: 0 } }
                migratedUnread = true
            }
        }
        if (!current || JSON.stringify(current) !== JSON.stringify(entry)) {
            store[session.id] = entry
            changed = true
        }
    }
    if (changed && save(store)) {
        notify()
        if (migratedUnread) void flushSessionReadState()
    }
}

function readLegacyReadState(legacyScope: string) {
    const read = (key: string): Record<string, number> => {
        try {
            const value: unknown = JSON.parse(localStorage.getItem(key) ?? '{}')
            return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, number> : {}
        } catch { return {} }
    }
    return {
        seen: read('hapi.sessionLastSeen.v1'),
        manual: read('hapi.sessionManualUnread.v1'),
        applied: read(`hapi.sessionAppliedRead.v1:${legacyScope}`)
    }
}

function legacyIsUnread(session: SessionInput, legacy: ReturnType<typeof readLegacyReadState>): boolean {
    const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
    const seen = legacy.seen[session.id]
    const manual = legacy.manual[session.id]
    const readThrough = session.metadata?.readThrough
    const freshHubRead = finite(readThrough) && readThrough > (legacy.applied[session.id] ?? 0)
    if (finite(manual) && !(freshHubRead && manual <= readThrough)) return true
    if (!finite(seen)) return false // A new browser retains upstream's historical baseline.
    const activity = session.lastAgentMessageAt ?? session.updatedAt ?? 0
    return activity > Math.max(seen, freshHubRead ? readThrough : 0)
}

function enqueue(sessionId: string, request: SessionReadStateRequest): void {
    if (!sessionId) return
    const store = readStore()
    const entry = store[sessionId] ?? { server: EMPTY_READ_STATE }
    const previous = entry.pending?.request
    if (request.type === 'read' && previous?.type === 'read') {
        request = { ...request, readRevision: Math.max(request.readRevision, previous.readRevision) }
    }
    store[sessionId] = { ...entry, pending: { id: crypto.randomUUID(), request } }
    // Persistence failure must not claim a successful local read.
    if (save(store)) { notify(); void flushSessionReadState() }
}

export function getSessionLastSeenAt(sessionId: string): number { return effective(readStore()[sessionId]).readRevision }
export function getSessionManualUnreadAt(sessionId: string, serverState?: SessionReadState): number | null {
    return effective(readStore()[sessionId], serverState).manualUnread ? 0 : null
}
export function getSessionLastSeenSnapshot(): Readonly<Record<string, number>> {
    return Object.fromEntries(Object.entries(readStore()).map(([id, entry]) => [id, effective(entry).readRevision]))
}
export function getSessionManualUnreadSnapshot(sessions: readonly SessionInput[] = []): Readonly<Record<string, number | null>> {
    const store = readStore()
    return Object.fromEntries(sessions.map(session => [session.id, effective(store[session.id], session.readState).manualUnread ? 0 : null]))
}
export function markSessionSeen(sessionId: string, readRevision: number, observedVersion?: number): void {
    if (!Number.isSafeInteger(readRevision) || readRevision < 0) return
    const entry = readStore()[sessionId]
    const current = effective(entry)
    if (current.readRevision >= readRevision && !current.manualUnread) return
    enqueue(sessionId, { type: 'read', readRevision, expectedVersion: observedVersion ?? entry?.server.version ?? 0 })
}
export function markSessionUnread(sessionId: string, observedState?: SessionReadState): void {
    if (observedState) observeSessionReadStates([{ id: sessionId, readState: observedState }])
    enqueue(sessionId, { type: 'unread', expectedVersion: readStore()[sessionId]?.server.version ?? 0 })
}
export function markAllSessionsSeen(sessions: Iterable<SessionInput>): number {
    const list = uniqueSessions(sessions).filter(s => !s.metadata?.muted)
    observeSessionReadStates(list)
    const store = readStore()
    let count = 0
    for (const session of list) {
        const entry = store[session.id] ?? { server: session.readState ?? EMPTY_READ_STATE }
        const state = effective(entry, session.readState)
        if (state.manualUnread || (session.contentRevision ?? 0) > state.readRevision) {
            store[session.id] = { ...entry, pending: { id: crypto.randomUUID(), request: {
                type: 'read', readRevision: Math.max(state.readRevision, session.contentRevision ?? 0),
                expectedVersion: entry.server.version
            } } }
            count += 1
        }
    }
    if (count > 0) {
        if (!save(store)) return 0
        notify()
        void flushSessionReadState()
    }
    return count
}
function uniqueSessions(sessions: Iterable<SessionInput>): SessionInput[] {
    const unique = new Map<string, SessionInput>()
    for (const session of sessions) {
        const prior = unique.get(session.id)
        unique.set(session.id, prior ? {
            ...((session.contentRevision ?? 0) >= (prior.contentRevision ?? 0) ? session : prior),
            contentRevision: Math.max(prior.contentRevision ?? 0, session.contentRevision ?? 0),
            readState: mergeReadState(prior.readState, session.readState)
        } : session)
    }
    return [...unique.values()]
}
export function getUnreadSessionCount(sessions: Iterable<SessionInput>): number {
    const store = readStore()
    return uniqueSessions(sessions).filter(session => {
        const state = effective(store[session.id], session.readState)
        return !session.metadata?.muted && (state.manualUnread
            || (session.contentRevision ?? 0) > Math.max(state.readRevision, session.readState?.readRevision ?? 0))
    }).length
}
function subscribe(listener: () => void): () => void {
    const storage = (event: StorageEvent) => {
        if (event.key === PREFIX + scope || event.key === null) { changeVersion += 1; listener(); void flushSessionReadState() }
    }
    window.addEventListener(CHANGE_EVENT, listener)
    window.addEventListener('storage', storage)
    return () => { window.removeEventListener(CHANGE_EVENT, listener); window.removeEventListener('storage', storage) }
}
export function useSessionLastSeenVersion(): number {
    return useSyncExternalStore(subscribe, () => changeVersion, () => 0)
}
