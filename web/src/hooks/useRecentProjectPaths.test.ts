import { describe, expect, it } from 'vitest'
import type { SessionSummary } from '@/types/api'
import { getRecentProjectPaths } from './useRecentProjectPaths'

function session(id: string, overrides: Partial<SessionSummary> = {}): SessionSummary {
    return {
        id,
        active: false,
        thinking: false,
        activeAt: 0,
        updatedAt: 0,
        metadata: { path: `/home/me/${id}` },
        metadataVersion: 0,
        agentStateVersion: 0,
        todosUpdatedAt: 0,
        todoProgress: null,
        pendingRequestsCount: 0,
        pendingRequestKinds: [],
        pendingRequests: [],
        backgroundTaskCount: 0,
        futureScheduledMessageCount: 0,
        nextScheduledAt: null,
        model: null,
        effort: null,
        ...overrides,
    } as SessionSummary
}

describe('getRecentProjectPaths', () => {
    it('lists distinct project paths of the selected machine, most recent activity first', () => {
        const paths = getRecentProjectPaths([
            session('a', { metadata: { path: '/repo/old', machineId: 'm1' }, lastUserMessageAt: 100 }),
            session('b', { metadata: { path: '/repo/new', machineId: 'm1' }, lastUserMessageAt: 300 }),
            session('c', { metadata: { path: '/repo/mid', machineId: 'm1' }, lastUserMessageAt: 200 }),
            session('d', { metadata: { path: '/repo/other-machine', machineId: 'm2' }, lastUserMessageAt: 400 }),
        ], 'm1')

        expect(paths).toEqual(['/repo/new', '/repo/mid', '/repo/old'])
    })

    it('keeps only the latest activity per repeated path and caps the list', () => {
        const sessions = [
            session('a', { metadata: { path: `/repo/p${1}`, machineId: 'm1' }, lastUserMessageAt: 5 }),
        ]
        for (let index = 2; index <= 12; index += 1) {
            sessions.push(session(`s${index}`, {
                metadata: { path: `/repo/p${index}`, machineId: 'm1' },
                lastUserMessageAt: index * 10,
            }))
        }
        // A stale session on an already-listed path must not reorder it.
        sessions.push(session('stale', { metadata: { path: '/repo/p12', machineId: 'm1' }, lastUserMessageAt: 5 }))

        const paths = getRecentProjectPaths(sessions, 'm1')
        expect(paths).toHaveLength(10)
        expect(paths[0]).toBe('/repo/p12')
        expect(paths).not.toContain('/repo/p1')
    })

    it('returns nothing without a machine or when sessions carry no path', () => {
        expect(getRecentProjectPaths([session('a')], null)).toEqual([])
        expect(getRecentProjectPaths([session('a', { metadata: null })], 'm1')).toEqual([])
    })
})
