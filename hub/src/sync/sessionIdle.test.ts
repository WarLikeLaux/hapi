import { describe, expect, it } from 'bun:test'
import { Store } from '../store'
import { SessionCache } from './sessionCache'
import type { EventPublisher } from './eventPublisher'

describe('session inactivity', () => {
    it('keeps running sessions running and clears old idle marks without parking them', () => {
        const store = new Store(':memory:')
        const cache = new SessionCache(store, { emit: () => {} } as unknown as EventPublisher)
        const make = (tag: string, lifecycleState: string) => cache.getOrCreateSession(tag,
            { path: '/tmp/project', host: 'localhost', lifecycleState }, null, 'default').id
        const running = make('running', 'running')
        const idle = make('idle', 'idle')
        const parked = make('parked', 'parked')
        cache.handleSessionAlive({ sid: running, time: Date.now() })
        cache.handleSessionAlive({ sid: idle, time: Date.now() })
        cache.reconcileKeepaliveIdle(Date.now() + 365 * 86400_000, 1)
        expect(cache.getSession(running)?.metadata?.lifecycleState).toBe('running')
        expect(cache.getSession(idle)?.metadata?.lifecycleState).toBe('running')
        expect(cache.getSession(idle)?.active).toBe(true)
        expect(cache.getSession(parked)?.metadata?.lifecycleState).toBe('parked')
    })
})
