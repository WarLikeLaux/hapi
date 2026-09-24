import { describe, expect, it } from 'vitest'
import {
    computeContextStats,
    detectDefaultSessionContext,
    resolveSessionContext,
    type SessionContextId,
} from './sessionContexts'
import type { SessionSummary } from '@/types/api'

function makeTestSession(overrides: Partial<SessionSummary> = {}): SessionSummary {
    return {
        id: `sess-${Math.random().toString(36).slice(2)}`,
        active: true,
        thinking: false,
        activeAt: Date.now(),
        updatedAt: Date.now(),
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
        metadata: {
            path: '/work/internal-service',
            name: 'internal-service',
        },
        ...overrides,
    }
}

describe('sessionContexts', () => {
    describe('detectDefaultSessionContext', () => {
        it('classifies work paths and ticket branches as work', () => {
            const sess1 = makeTestSession({
                metadata: { path: '/home/user/work/service-api', name: 'service-api' }
            })
            expect(detectDefaultSessionContext(sess1)).toBe('work')

            const sess2 = makeTestSession({
                metadata: {
                    path: '/workspace/backend',
                    worktree: { basePath: '/workspace/backend', name: 'PROJ-1063_fix_dialog', branch: 'PROJ-1063_fix_dialog' }
                }
            })
            expect(detectDefaultSessionContext(sess2)).toBe('work')
        })

        it('classifies root code directory or standalone chat as chill', () => {
            const sess1 = makeTestSession({
                metadata: { path: '/home/user/code', name: 'code' }
            })
            expect(detectDefaultSessionContext(sess1)).toBe('chill')

            const sess2 = makeTestSession({
                metadata: { path: 'Other' }
            })
            expect(detectDefaultSessionContext(sess2)).toBe('chill')

            const sess3 = makeTestSession({
                metadata: null
            })
            expect(detectDefaultSessionContext(sess3)).toBe('chill')
        })

        it('classifies other distinct projects as lab', () => {
            const sess1 = makeTestSession({
                metadata: { path: '/home/user/projects/pet-tool', name: 'pet-tool' }
            })
            expect(detectDefaultSessionContext(sess1)).toBe('lab')

            const sess2 = makeTestSession({
                metadata: { path: '/workspace/my-library', name: 'my-library' }
            })
            expect(detectDefaultSessionContext(sess2)).toBe('lab')
        })
    })

    describe('resolveSessionContext with user overrides', () => {
        it('respects path overrides over heuristic', () => {
            const sess = makeTestSession({
                metadata: { path: '/work/internal-service', name: 'internal-service' }
            })
            const overrides: Record<string, SessionContextId> = {
                '/work/internal-service': 'lab',
            }
            expect(resolveSessionContext(sess, overrides)).toBe('lab')
        })

        it('respects project name overrides', () => {
            const sess = makeTestSession({
                metadata: { path: '/workspace/custom-repo', name: 'custom-repo' }
            })
            const overrides: Record<string, SessionContextId> = {
                'custom-repo': 'work',
            }
            expect(resolveSessionContext(sess, overrides)).toBe('work')
        })
    })

    describe('computeContextStats', () => {
        it('calculates total, working, and unread counts correctly', () => {
            const workWorking = makeTestSession({
                metadata: { path: '/work/service-api' },
                thinking: true,
                active: true,
            })
            const workIdle = makeTestSession({
                metadata: { path: '/work/service-mcp' },
                thinking: false,
            })
            const labWorking = makeTestSession({
                metadata: { path: '/projects/pet-tool' },
                backgroundTaskCount: 2,
                active: true,
            })
            const chillSession = makeTestSession({
                metadata: { path: '/home/user/code' },
            })

            const sessions = [workWorking, workIdle, labWorking, chillSession]
            const stats = computeContextStats(sessions)

            expect(stats.all.totalCount).toBe(4)
            expect(stats.all.workingCount).toBe(2)

            expect(stats.work.totalCount).toBe(2)
            expect(stats.work.workingCount).toBe(1)

            expect(stats.lab.totalCount).toBe(1)
            expect(stats.lab.workingCount).toBe(1)

            expect(stats.chill.totalCount).toBe(1)
            expect(stats.chill.workingCount).toBe(0)
        })
    })
})
