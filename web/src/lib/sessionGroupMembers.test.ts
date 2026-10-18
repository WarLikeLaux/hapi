import { describe, expect, it } from 'vitest'
import type { SessionGroup } from '@hapi/protocol'
import type { SessionSummary } from '@/types/api'
import { getSessionGroupMembers } from './sessionGroupMembers'

const chat = (id: string, extra: Partial<SessionSummary> = {}) => ({
    id, active: true, thinking: false, lastUserMessageAt: 100, lastAgentMessageAt: 200,
    metadata: { path: '/work', lifecycleState: 'running' }, ...extra,
}) as SessionSummary
const group = (ids: string[], pinned: string[] = []): SessionGroup => ({
    id: 'group', name: 'Group', version: 1, updatedAt: 0,
    members: ids.map(sessionId => ({ sessionId, pinned: pinned.includes(sessionId) })),
})
const order = (g: SessionGroup, sessions: SessionSummary[]) => getSessionGroupMembers(g, sessions).map(member => member.sessionId)

describe('group tab priority', () => {
    it('preserves manual order within pins, questions, completed turns and other chats', () => {
        const sessions = [chat('working', { thinking: true }), chat('done-a', { lastReadyAt: 300 }),
            chat('pin-a'), chat('question-a', { pendingRequestKinds: ['input'], thinking: true }),
            chat('done-b', { lastReadyAt: 400 }), chat('pin-b', { pendingRequestKinds: ['input'] }),
            chat('permission', { pendingRequestKinds: ['permission'] }), chat('empty', { lastAgentMessageAt: 0 }),
            chat('question-b', { pendingAsyncQuestionsCount: 1 })]
        const g = group(sessions.map(s => s.id), ['pin-a', 'pin-b'])
        expect(order(g, sessions)).toEqual(['pin-a', 'pin-b', 'question-a', 'permission', 'question-b', 'done-a', 'done-b', 'working', 'empty'])
        expect(g.members.map(m => m.sessionId)).toEqual(sessions.map(s => s.id))
    })

    it.each([
        ['no ready boundary', {}], ['heartbeat only', { lastReadyAt: 0 }],
        ['new work', { thinking: true, lastReadyAt: 300 }],
        ['new user input', { lastUserMessageAt: 400, lastReadyAt: 300 }],
        ['output after ready', { lastAgentMessageAt: 400, lastReadyAt: 300 }],
        ['background work', { backgroundTaskCount: 1, lastReadyAt: 300 }],
        ['no answer yet', { lastAgentMessageAt: 0, lastReadyAt: 300 }],
        ['disconnected', { active: false, lastReadyAt: 300 }],
    ] as const)('does not promote %s as a completed turn', (_name, extra) => {
        expect(order(group(['first', 'candidate']), [chat('first'), chat('candidate', extra)])).toEqual(['first', 'candidate'])
    })

    it('restores the manual order after answering or starting another turn, independently of read state', () => {
        const g = group(['ordinary', 'worker', 'question'])
        const sessions = [chat('ordinary'), chat('worker', { lastReadyAt: 300 }), chat('question', { pendingRequestKinds: ['input'] })]
        expect(order(g, sessions)).toEqual(['question', 'worker', 'ordinary'])
        const resumed = sessions.map(s => s.id === 'question' ? { ...s, pendingRequestKinds: [], thinking: true }
            : s.id === 'worker' ? { ...s, thinking: true } : s)
        expect(order(g, resumed)).toEqual(['ordinary', 'worker', 'question'])
    })

    it('never restores archived or missing members, even pinned ones', () => {
        expect(order(group(['closed', 'missing', 'live'], ['closed']), [
            chat('closed', { lastReadyAt: 300, metadata: { path: '/work', lifecycleState: 'archived' } }), chat('live'),
        ])).toEqual(['live'])
    })
})
