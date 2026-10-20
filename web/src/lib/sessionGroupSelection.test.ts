import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionGroup } from '@hapi/protocol'
import type { SessionSummary } from '@/types/api'
import { getGroupEntrySession, rememberGroupSession } from './sessionGroupSelection'

const chat = (id: string, extra: Partial<SessionSummary> = {}) => ({
    id, active: true, thinking: false, updatedAt: 100, lastAgentMessageAt: 0,
    metadata: { path: '/work', lifecycleState: 'running' }, ...extra,
}) as SessionSummary
const group: SessionGroup = {
    id: 'group', name: 'Group', closed: false, parked: false, version: 1, updatedAt: 0,
    members: ['quiet', 'unread', 'permission', 'question', 'pinned-question'].map(sessionId => ({
        sessionId, pinned: ['quiet', 'unread', 'pinned-question'].includes(sessionId),
    })),
}

afterEach(() => { localStorage.clear(); vi.restoreAllMocks() })

describe('group entry candidate ordering', () => {
    it.each([
        ['pins within questions', { pendingRequestKinds: ['input'] }, { pendingRequestKinds: ['input'] }, 'pinned-question'],
        ['async question without kinds', { pendingAsyncQuestionsCount: 1, thinking: true }, {}, 'question'],
        ['question while thinking', { pendingRequestKinds: ['input'], thinking: true }, {}, 'question'],
        ['permission before pinned unread', {}, {}, 'permission'],
    ] satisfies [string, Partial<SessionSummary>, Partial<SessionSummary>, string][])(
        '%s', (_label, question, pinnedQuestion, expected) => {
            const sessions = [chat('quiet'), chat('unread', { lastAgentMessageAt: 200 }),
                chat('permission', { pendingRequestKinds: ['permission'], thinking: true }),
                chat('question', question), chat('pinned-question', pinnedQuestion)]
            rememberGroupSession('hub', group.id, 'quiet')
            expect(getGroupEntrySession('hub', group, sessions)).toBe(expected)
        },
    )

    it('uses manual tab order to break ties between unpinned questions', () => {
        const unpinned = { ...group, members: group.members.map(m => ({ ...m, pinned: false })) }
        expect(getGroupEntrySession('hub', unpinned, [
            chat('pinned-question', { pendingRequestKinds: ['input'] }),
            chat('question', { pendingRequestKinds: ['input'] }),
        ])).toBe('question')
    })

    it.each([
        ['ordinary unread', {}, 'unread'],
        ['thinking defers unread', { thinking: true }, 'quiet'],
        ['background work defers unread', { backgroundTaskCount: 1 }, 'quiet'],
    ] satisfies [string, Partial<SessionSummary>, string][])(
        '%s', (_label, extra, expected) => {
            rememberGroupSession('hub', group.id, 'quiet')
            expect(getGroupEntrySession('hub', group, [chat('quiet'), chat('unread', { lastAgentMessageAt: 200, ...extra })])).toBe(expected)
        },
    )

    it('isolates remembered selections by hub as well as group', () => {
        const sessions = [chat('quiet'), chat('unread')]
        rememberGroupSession('hub-a', group.id, 'unread')
        expect(getGroupEntrySession('hub-b', group, sessions)).toBe('quiet')
        expect(getGroupEntrySession('hub-a', group, sessions)).toBe('unread')
    })

    it('keeps navigation usable when localStorage is blocked', () => {
        vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => { throw new Error('blocked') })
        vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => { throw new Error('blocked') })
        expect(() => rememberGroupSession('hub', group.id, 'quiet')).not.toThrow()
        expect(getGroupEntrySession('hub', group, [chat('quiet')])).toBe('quiet')
        expect(getGroupEntrySession('hub', group, [])).toBeNull()
    })
})
