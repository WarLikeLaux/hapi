import { describe, expect, it } from 'bun:test'
import type { SyncEvent } from '@hapi/protocol'
import { Store } from '../store'
import { SessionCache } from './sessionCache'
import type { EventPublisher } from './eventPublisher'

function setup() {
    const store = new Store(':memory:')
    const events: SyncEvent[] = []
    const cache = new SessionCache(store, { emit: (event: SyncEvent) => { events.push(event) } } as unknown as EventPublisher)
    const chat = (tag: string) => cache.getOrCreateSession(tag, { path: '/work', host: 'test', flavor: 'codex', lifecycleState: 'running' }, null, 'team')
    return { store, cache, events, chat }
}

describe('group membership on session rotation', () => {
    it('preserves the tab position, pin and history when reopening rotates a member ID', async () => {
        const { store, cache, events, chat } = setup()
        try {
            const [first, original, last, replacement] = ['first', 'original', 'last', 'replacement'].map(chat)
            const created = store.groups.create('team', 'Workspace')
            const group = store.groups.update('team', created.id, { ...created, members: [
                { sessionId: first.id, pinned: true }, { sessionId: original.id, pinned: true }, { sessionId: last.id, pinned: false },
            ] })
            store.messages.addMessage(original.id, { role: 'user', content: { type: 'text', text: 'Original history' } })
            store.groups.beginLifecycle('team', group.id, group.version)
            await cache.mergeSessions(original.id, replacement.id, 'team')
            const reopened = store.groups.finishLifecycle('team', group.id, false)
            expect(reopened.members).toEqual([
                { sessionId: first.id, pinned: true }, { sessionId: replacement.id, pinned: true }, { sessionId: last.id, pinned: false },
            ])
            expect(store.sessions.getSession(original.id)).toBeNull()
            expect(store.messages.getMessages(replacement.id)).toHaveLength(1)
            expect(events).toContainEqual({ type: 'groups-updated', namespace: 'team' })
        } finally { store.close() }
    })

    it('refuses to merge into another group before moving history or deleting either tab', async () => {
        const { store, cache, chat } = setup()
        try {
            const source = chat('source')
            const target = chat('target')
            const first = store.groups.create('team', 'First')
            const second = store.groups.create('team', 'Second')
            store.groups.add('team', first.id, source.id)
            store.groups.add('team', second.id, target.id)
            store.messages.addMessage(source.id, { role: 'user', content: { type: 'text', text: 'Source history' } })
            await expect(cache.mergeSessions(source.id, target.id, 'team')).rejects.toThrow('another group')
            expect(store.groups.forSession('team', source.id)?.id).toBe(first.id)
            expect(store.groups.forSession('team', target.id)?.id).toBe(second.id)
            expect(store.messages.getMessages(source.id)).toHaveLength(1)
            expect(store.messages.getMessages(target.id)).toHaveLength(0)
        } finally { store.close() }
    })
})
