import { describe, expect, it } from 'bun:test'
import type { SyncEvent } from '@hapi/protocol/types'
import { Store } from '../store'
import type { EventPublisher } from './eventPublisher'
import { SessionCache } from './sessionCache'

function createPublisher(events: SyncEvent[]): EventPublisher {
    return {
        emit: (event: SyncEvent) => events.push(event)
    } as unknown as EventPublisher
}

describe('SessionCache.updateSessionSummary', () => {
    it('preserves metadata.name while stamping the generated summary timestamp', async () => {
        const store = new Store(':memory:')
        const cache = new SessionCache(store, createPublisher([]))
        const created = cache.getOrCreateSession(
            'summary-session',
            { path: '/tmp', host: 'localhost', name: 'Manual name' },
            null,
            'default'
        )

        await cache.updateSessionSummary(created.id, 'Generated title')

        const updated = cache.getSession(created.id)
        expect(updated?.metadata?.name).toBe('Manual name')
        expect(updated?.metadata?.summary?.text).toBe('Generated title')
        expect(updated?.metadata?.summary?.updatedAt).toBeGreaterThan(0)

        const stored = store.sessions.getSession(created.id)
        expect(stored?.metadata).toMatchObject({
            name: 'Manual name',
            summary: { text: 'Generated title' }
        })
    })
})

describe('protected titles across session continuation', () => {
    it('retains the original protected session if transferring its metadata fails', async () => {
        const store = new Store(':memory:')
        const cache = new SessionCache(store, createPublisher([]))
        const original = cache.getOrCreateSession('original', { path: '/tmp', host: 'localhost', name: 'Координатор', nameLock: 'user' }, null, 'default')
        const resumed = cache.getOrCreateSession('resumed', { path: '/tmp', host: 'localhost', name: 'Automatic' }, null, 'default')
        // The real store reports write failures instead of throwing (for example,
        // after a SQLite write error). The merge must not delete the only title copy.
        store.sessions.updateSessionMetadata = () => ({ result: 'error' })
        await expect(cache.mergeSessions(original.id, resumed.id, 'default')).rejects.toThrow()
        expect(store.sessions.getSession(original.id)?.metadata).toMatchObject({ name: 'Координатор', nameLock: 'user' })
        store.close()
    })

    for (const [oldLock, newLock, expectedName, expectedLock] of [
        ['user', undefined, 'Original', 'user'],
        ['agent', undefined, 'Original', 'agent'],
        ['user', 'agent', 'Original', 'user'],
        ['agent', 'user', 'Resumed', 'user'],
        ['user', 'user', 'Resumed', 'user'],
    ] as const) {
        it(`keeps title ownership when merging ${oldLock} into ${newLock ?? 'automatic'}`, async () => {
            const store = new Store(':memory:')
            const cache = new SessionCache(store, createPublisher([]))
            const oldSession = cache.getOrCreateSession('old', { path: '/tmp', host: 'localhost', name: 'Original', nameLock: oldLock }, null, 'default')
            const resumed = cache.getOrCreateSession('resumed', { path: '/tmp', host: 'localhost', name: 'Resumed', nameLock: newLock }, null, 'default')
            await cache.mergeSessions(oldSession.id, resumed.id, 'default')
            const current = store.sessions.getSession(resumed.id)!
            expect(current.metadata).toMatchObject({ name: expectedName, nameLock: expectedLock })
            const update = store.sessions.updateSessionMetadata(resumed.id, { name: 'Later automatic title' }, current.metadataVersion, 'default')
            expect(update).toMatchObject({ result: 'success', value: { name: expectedName, nameLock: expectedLock } })
            store.close()
        })
    }
})
