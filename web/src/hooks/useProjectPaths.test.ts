import { describe, expect, it } from 'vitest'
import type { SessionSummary } from '@/types/api'
import { getProjectPaths, MIN_SESSIONS_FOR_PICKER, RECENT_PROJECT_PATHS_LIMIT } from './useProjectPaths'

function session(
    id: string,
    path: string,
    overrides: Partial<SessionSummary> = {}
): SessionSummary {
    return {
        id,
        active: false,
        thinking: false,
        activeAt: 0,
        updatedAt: 0,
        metadata: { path, machineId: 'm1', ...overrides.metadata },
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

describe('getProjectPaths', () => {
    it('returns empty arrays when no machine is selected', () => {
        const sessions = [session('a', '/repo/x', { lastUserMessageAt: 100 })]
        expect(getProjectPaths(sessions, null)).toEqual({ workPaths: [], recentPaths: [] })
    })

    it('hides paths with fewer than MIN_SESSIONS_FOR_PICKER lifetime sessions', () => {
        const sessions = [
            // 3 sessions on /repo/keep → shown
            session('a', '/repo/keep', { lastUserMessageAt: 100 }),
            session('b', '/repo/keep', { lastUserMessageAt: 110 }),
            session('c', '/repo/keep', { lastUserMessageAt: 120 }),
            // 2 sessions on /repo/drop → hidden
            session('d', '/repo/drop', { lastUserMessageAt: 200 }),
            session('e', '/repo/drop', { lastUserMessageAt: 210 }),
            // 1 session on /repo/once → hidden
            session('f', '/repo/once', { lastUserMessageAt: 300 }),
        ]
        const { workPaths, recentPaths } = getProjectPaths(sessions, 'm1')
        expect(recentPaths).toEqual(['/repo/keep'])
        expect(workPaths).toEqual([])
    })

    it('splits paths by work classification using the work alias list', () => {
        const sessions = [
            session('a', '/code/corp-api', { lastUserMessageAt: 100 }),
            session('a2', '/code/corp-api', { lastUserMessageAt: 110 }),
            session('a3', '/code/corp-api', { lastUserMessageAt: 120 }),
            session('b', '/code/side-thing', { lastUserMessageAt: 200 }),
            session('b2', '/code/side-thing', { lastUserMessageAt: 210 }),
            session('b3', '/code/side-thing', { lastUserMessageAt: 220 }),
        ]
        const result = getProjectPaths(
            sessions,
            'm1',
            { workAliases: ['corp'] }
        )
        expect(result.workPaths).toContain('/code/corp-api')
        expect(result.recentPaths).toContain('/code/side-thing')
        expect(result.workPaths).not.toContain('/code/side-thing')
        expect(result.recentPaths).not.toContain('/code/corp-api')
    })

    it('orders work paths by lifetime session count (most sessions first)', () => {
        const sessions = [
            // /code/heavy has 5 sessions — should win despite older activity.
            session('h1', '/code/heavy', { lastUserMessageAt: 50 }),
            session('h2', '/code/heavy', { lastUserMessageAt: 55 }),
            session('h3', '/code/heavy', { lastUserMessageAt: 60 }),
            session('h4', '/code/heavy', { lastUserMessageAt: 65 }),
            session('h5', '/code/heavy', { lastUserMessageAt: 70 }),
            // /code/light has 3 sessions but newer activity.
            session('l1', '/code/light', { lastUserMessageAt: 300 }),
            session('l2', '/code/light', { lastUserMessageAt: 310 }),
            session('l3', '/code/light', { lastUserMessageAt: 320 }),
        ]
        const { workPaths } = getProjectPaths(sessions, 'm1', { workAliases: ['heavy', 'light'] })
        expect(workPaths).toEqual(['/code/heavy', '/code/light'])
    })

    it('orders recent paths by the most recent session activity', () => {
        const sessions = [
            session('a', '/code/old', { lastUserMessageAt: 100 }),
            session('a2', '/code/old', { lastUserMessageAt: 105 }),
            session('a3', '/code/old', { lastUserMessageAt: 110 }),
            session('b', '/code/new', { lastUserMessageAt: 300 }),
            session('b2', '/code/new', { lastUserMessageAt: 310 }),
            session('b3', '/code/new', { lastUserMessageAt: 320 }),
        ]
        const { recentPaths } = getProjectPaths(sessions, 'm1')
        expect(recentPaths).toEqual(['/code/new', '/code/old'])
    })

    it('breaks session-count ties in work paths by the most recent activity', () => {
        const sessions = [
            session('a', '/code/stale', { lastUserMessageAt: 50 }),
            session('a2', '/code/stale', { lastUserMessageAt: 55 }),
            session('a3', '/code/stale', { lastUserMessageAt: 60 }),
            session('b', '/code/fresh', { lastUserMessageAt: 200 }),
            session('b2', '/code/fresh', { lastUserMessageAt: 205 }),
            session('b3', '/code/fresh', { lastUserMessageAt: 210 }),
        ]
        const { workPaths } = getProjectPaths(sessions, 'm1', { workAliases: ['stale', 'fresh'] })
        expect(workPaths).toEqual(['/code/fresh', '/code/stale'])
    })

    it('honors the recent path cap on each row independently', () => {
        const sessions: SessionSummary[] = []
        // 12 work paths and 12 non-work paths, each with exactly 3 sessions.
        // Use letter-only suffixes so the TICKET_PATTERN heuristic does not
        // re-classify the side paths as work.
        const letters = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot',
            'golf', 'hotel', 'india', 'juliet', 'kilo', 'lima']
        for (let i = 0; i < 12; i += 1) {
            const path = `/code/corp-${letters[i]}`
            for (let j = 1; j <= 3; j += 1) {
                sessions.push(session(`${path}-${j}`, path, { lastUserMessageAt: i * 10 + j }))
            }
        }
        for (let i = 0; i < 12; i += 1) {
            const path = `/code/side-${letters[i]}`
            for (let j = 1; j <= 3; j += 1) {
                sessions.push(session(`${path}-${j}`, path, { lastUserMessageAt: i * 10 + j }))
            }
        }
        const { workPaths, recentPaths } = getProjectPaths(
            sessions,
            'm1',
            { workAliases: ['corp'] }
        )
        expect(workPaths).toHaveLength(RECENT_PROJECT_PATHS_LIMIT)
        expect(recentPaths).toHaveLength(RECENT_PROJECT_PATHS_LIMIT)
    })

    it('ignores sessions from other machines', () => {
        const sessions = [
            session('a', '/code/x', { metadata: { path: '/code/x', machineId: 'm2' }, lastUserMessageAt: 100 }),
            session('b', '/code/x', { metadata: { path: '/code/x', machineId: 'm2' }, lastUserMessageAt: 200 }),
            session('c', '/code/x', { metadata: { path: '/code/x', machineId: 'm2' }, lastUserMessageAt: 300 }),
        ]
        expect(getProjectPaths(sessions, 'm1')).toEqual({ workPaths: [], recentPaths: [] })
    })

    it('applies projectOverrides before falling back to the alias heuristic', () => {
        const sessions = [
            session('a', '/code/side', { lastUserMessageAt: 100 }),
            session('b', '/code/side', { lastUserMessageAt: 110 }),
            session('c', '/code/side', { lastUserMessageAt: 120 }),
        ]
        const result = getProjectPaths(sessions, 'm1', {
            workAliases: ['corp'],
            projectOverrides: { '/code/side': 'work' },
        })
        expect(result.workPaths).toEqual(['/code/side'])
        expect(result.recentPaths).toEqual([])
    })

    it('exposes the threshold and cap as constants', () => {
        expect(MIN_SESSIONS_FOR_PICKER).toBe(3)
        expect(RECENT_PROJECT_PATHS_LIMIT).toBe(10)
    })
})