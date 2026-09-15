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

describe('SessionCache.setSessionDifitReview', () => {
    it('persists the link and only detaches the review that still owns the button', async () => {
        const store = new Store(':memory:')
        const events: SyncEvent[] = []
        const cache = new SessionCache(store, createPublisher(events))
        const created = cache.getOrCreateSession(
            'difit-session',
            { path: '/tmp', host: 'localhost' },
            null,
            'default'
        )
        const review = {
            id: 'review-current',
            url: 'https://difit.local/reviews/review-current/',
            branch: 'feature/review',
            attachedAt: 123
        }

        expect(await cache.setSessionDifitReview(created.id, review)).toBe(true)
        expect(cache.getSession(created.id)?.metadata?.difitReview).toEqual(review)
        expect(await cache.setSessionDifitReview(created.id, null, 'review-old')).toBe(false)
        expect(cache.getSession(created.id)?.metadata?.difitReview).toEqual(review)
        expect(await cache.setSessionDifitReview(created.id, null, review.id)).toBe(true)
        expect(cache.getSession(created.id)?.metadata?.difitReview).toBeUndefined()
        expect(events.some((event) => event.type === 'session-updated')).toBe(true)
    })
})
