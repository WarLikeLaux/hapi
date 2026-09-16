import type { ExternalConversation } from '@hapi/protocol'
import type { SessionSummary } from '@/types/api'

/** Count conversations with unread activity, not individual unread messages. */
export function countUnreadConversations(
    conversations: readonly Pick<ExternalConversation, 'unreadCount'>[]
): number {
    return conversations.reduce(
        (count, conversation) => count + (conversation.unreadCount > 0 ? 1 : 0),
        0
    )
}

/** Count active agent conversations that are currently doing foreground or background work. */
export function isWorkingSession(session: SessionSummary): boolean {
    return session.active && (session.thinking || (session.backgroundTaskCount ?? 0) > 0)
}

export function countWorkingSessions(sessions: readonly SessionSummary[]): number {
    return sessions.reduce(
        (count, session) => count + (isWorkingSession(session) ? 1 : 0),
        0
    )
}
