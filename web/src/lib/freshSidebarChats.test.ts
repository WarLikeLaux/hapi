import { describe, expect, it } from 'vitest'
import type { ExternalConversation } from '@hapi/protocol/messengers'
import type { SessionSummary } from '@/types/api'
import {
    getChatSortAt,
    isFreshConversation,
    mergeSidebarChatRows,
    selectFreshSidebarConversations,
} from './freshSidebarChats'

const HOUR = 60 * 60_000

function makeConversation(overrides: Partial<ExternalConversation> = {}): ExternalConversation {
    return {
        id: 'conversation-1',
        provider: 'telegram',
        remoteId: '100',
        title: 'Test chat',
        customTitle: null,
        kind: 'direct',
        selected: true,
        lastMessageAt: null,
        lastMessagePreview: null,
        lastMessageDirection: null,
        unreadCount: 0,
        avatarDataUrl: null,
        ...overrides,
    }
}

function makeSession(overrides: Partial<SessionSummary> = {}): SessionSummary {
    return {
        id: 'session-1',
        active: true,
        createdAt: HOUR,
        updatedAt: HOUR,
        lastMessageAt: null,
        lastAgentMessageAt: null,
        hasConversationContent: true,
        metadata: {},
        ...overrides,
    } as SessionSummary
}

describe('isFreshConversation', () => {
    it('always treats unread chats as fresh regardless of the window', () => {
        const old = makeConversation({ unreadCount: 2, lastMessageAt: 1_000 })
        expect(isFreshConversation(old, { windowMs: HOUR, now: 1_000 + 10 * HOUR })).toBe(true)
    })

    it('keeps read chats inside the grace window and drops older ones', () => {
        const recent = makeConversation({ unreadCount: 0, lastMessageAt: 5_000 })
        const stale = makeConversation({ unreadCount: 0, lastMessageAt: 3_000 })
        expect(isFreshConversation(recent, { windowMs: HOUR, now: 4_000 + HOUR })).toBe(true)
        expect(isFreshConversation(stale, { windowMs: HOUR, now: 4_000 + HOUR })).toBe(false)
    })

    it('drops read chats without a timestamp', () => {
        const conversation = makeConversation({ unreadCount: 0, lastMessageAt: null })
        expect(isFreshConversation(conversation, { windowMs: HOUR, now: 1_000 })).toBe(false)
    })
})

describe('selectFreshSidebarConversations', () => {
    it('returns nothing when the window is off', () => {
        const conversations = [makeConversation({ unreadCount: 1 })]
        expect(selectFreshSidebarConversations(conversations, 0, 1_000)).toEqual([])
    })

    it('sorts fresh chats newest first', () => {
        const now = 10 * HOUR
        const conversations = [
            makeConversation({ id: 'old', unreadCount: 0, lastMessageAt: now - 7 * HOUR }),
            makeConversation({ id: 'unread-old', unreadCount: 1, lastMessageAt: 10 }),
            makeConversation({ id: 'new', unreadCount: 0, lastMessageAt: now - HOUR }),
        ]
        const fresh = selectFreshSidebarConversations(conversations, 6 * HOUR, now)
        expect(fresh.map((conversation) => conversation.id)).toEqual(['new', 'unread-old'])
    })
})

describe('mergeSidebarChatRows', () => {
    it('interleaves chats between sessions by recency', () => {
        const now = 10 * HOUR
        const sessions = [
            makeSession({ id: 's1', lastAgentMessageAt: now - HOUR }),
            makeSession({ id: 's2', lastAgentMessageAt: now - 3 * HOUR }),
            makeSession({ id: 's3', lastAgentMessageAt: now - 5 * HOUR }),
        ]
        const conversations = [
            makeConversation({ id: 'c1', unreadCount: 0, lastMessageAt: now - 2 * HOUR }),
            makeConversation({ id: 'c2', unreadCount: 1, lastMessageAt: now - 4 * HOUR }),
        ]
        const rows = mergeSidebarChatRows(sessions, conversations)
        expect(rows.map((row) => row.key)).toEqual([
            'session:s1',
            'chat:c1',
            'session:s2',
            'chat:c2',
            'session:s3',
        ])
    })

    it('keeps sessions ahead on ties and preserves order within each list', () => {
        const at = 5 * HOUR
        const sessions = [makeSession({ id: 'a', lastAgentMessageAt: at }), makeSession({ id: 'b', lastAgentMessageAt: at })]
        const conversations = [makeConversation({ id: 'c1', unreadCount: 1, lastMessageAt: at })]
        const rows = mergeSidebarChatRows(sessions, conversations)
        expect(rows.map((row) => row.key)).toEqual(['session:a', 'session:b', 'chat:c1'])
    })

    it('exposes chat sort timestamps', () => {
        const conversation = makeConversation({ lastMessageAt: 1_234 })
        expect(getChatSortAt(conversation)).toBe(1_234)
        expect(getChatSortAt(makeConversation({ lastMessageAt: null }))).toBe(0)
    })
})
