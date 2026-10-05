import type { ExternalConversation } from '@hapi/protocol/messengers'
import type { SessionSummary } from '@/types/api'
import { getSessionUnreadActivityAt } from '@/lib/sessionAttention'

// Fresh messenger chats ride inside the active-sessions list: interleaved by
// recency so a new chat lands where the eye already is, not in a far section.
// Unread chats ignore the grace window entirely — only already-read chats age
// out of the list.

export type SidebarChatRow =
    | { kind: 'session'; key: string; session: SessionSummary; sortAt: number }
    | { kind: 'chat'; key: string; conversation: ExternalConversation; sortAt: number }

export function getChatSortAt(conversation: ExternalConversation): number {
    return conversation.lastMessageAt ?? 0
}

/** Unread chats are always fresh; read ones stay for the grace window only. */
export function isFreshConversation(
    conversation: ExternalConversation,
    options: { windowMs: number; now: number }
): boolean {
    if (conversation.unreadCount > 0) {
        return true
    }
    const lastMessageAt = conversation.lastMessageAt
    if (!lastMessageAt) {
        return false
    }
    return lastMessageAt > options.now - options.windowMs
}

export function selectFreshSidebarConversations(
    conversations: ExternalConversation[],
    windowMs: number,
    now: number
): ExternalConversation[] {
    if (!(windowMs > 0)) {
        return []
    }
    return conversations
        .filter(conversation => isFreshConversation(conversation, { windowMs, now }))
        .sort((a, b) => getChatSortAt(b) - getChatSortAt(a) || a.id.localeCompare(b.id))
}

// Two-way merge of two lists that are both newest-first: sessions keep their
// relative order, chats keep theirs, and rows interleave by timestamp.
export function mergeSidebarChatRows(
    sessions: SessionSummary[],
    conversations: ExternalConversation[]
): SidebarChatRow[] {
    const sessionRows: SidebarChatRow[] = sessions.map(session => ({
        kind: 'session',
        key: `session:${session.id}`,
        session,
        sortAt: getSessionUnreadActivityAt(session),
    }))
    const chatRows: SidebarChatRow[] = conversations.map(conversation => ({
        kind: 'chat',
        key: `chat:${conversation.id}`,
        conversation,
        sortAt: getChatSortAt(conversation),
    }))
    const rows: SidebarChatRow[] = []
    let sessionIndex = 0
    let chatIndex = 0
    while (sessionIndex < sessionRows.length && chatIndex < chatRows.length) {
        const nextSession = sessionRows[sessionIndex]
        const nextChat = chatRows[chatIndex]
        if (nextSession.sortAt >= nextChat.sortAt) {
            rows.push(nextSession)
            sessionIndex += 1
        } else {
            rows.push(nextChat)
            chatIndex += 1
        }
    }
    while (sessionIndex < sessionRows.length) {
        rows.push(sessionRows[sessionIndex])
        sessionIndex += 1
    }
    while (chatIndex < chatRows.length) {
        rows.push(chatRows[chatIndex])
        chatIndex += 1
    }
    return rows
}
