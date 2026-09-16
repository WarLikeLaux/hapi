import { describe, expect, it } from 'vitest'
import type { SessionSummary } from '@/types/api'
import { countUnreadConversations, countWorkingSessions } from './navigationBadges'

function createSession(overrides: Partial<SessionSummary>): SessionSummary {
    return {
        id: 'session',
        active: false,
        thinking: false,
        activeAt: 0,
        updatedAt: 0,
        metadata: null,
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
    }
}

describe('navigationBadges', () => {
    it('counts unread conversations instead of unread messages', () => {
        expect(countUnreadConversations([
            { unreadCount: 0 },
            { unreadCount: 1 },
            { unreadCount: 37 },
        ])).toBe(2)
    })

    it('counts active foreground and background agent work separately from idle sessions', () => {
        expect(countWorkingSessions([
            createSession({ id: 'thinking', active: true, thinking: true }),
            createSession({ id: 'background', active: true, backgroundTaskCount: 2 }),
            createSession({ id: 'idle', active: true }),
            createSession({ id: 'inactive', active: false, thinking: true }),
        ])).toBe(2)
    })
})
