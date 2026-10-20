import type { SessionGroup } from '@hapi/protocol'
import type { SessionSummary } from '@/types/api'
import { isWorkingSession } from './navigationBadges'

function priority(session: SessionSummary): number {
    if ((session.pendingRequestsCount ?? 0) > 0 || (session.pendingAsyncQuestionsCount ?? 0) > 0
        || session.pendingRequestKinds?.length) return 0
    const answerAt = session.lastAgentMessageAt ?? 0
    if (session.active && !isWorkingSession(session) && answerAt > 0
        && answerAt >= (session.lastUserMessageAt ?? session.createdAt ?? 0)
        && (session.lastReadyAt ?? 0) >= answerAt) return 1
    return 2
}

/** Pins, requests, completed turns, then other chats; manual order breaks ties. Never persist the derived order. */
export function getSessionGroupMembers(group: SessionGroup, sessions: readonly SessionSummary[]) {
    const byId = new Map(sessions.map(session => [session.id, session]))
    return group.members.flatMap(member => {
        const session = byId.get(member.sessionId)
        return session && (group.closed || session.metadata?.lifecycleState !== 'archived') ? [{ ...member, session }] : []
    }).sort((a, b) => Number(b.pinned) - Number(a.pinned)
        || (a.pinned ? 0 : priority(a.session) - priority(b.session)))
}
