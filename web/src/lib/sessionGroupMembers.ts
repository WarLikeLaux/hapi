import type { SessionGroup } from '@hapi/protocol'
import type { SessionSummary } from '@/types/api'

/** The tab strip renders pinned chats first, retaining order within each section. */
export function getSessionGroupMembers(group: SessionGroup, sessions: readonly SessionSummary[]) {
    const byId = new Map(sessions.map(session => [session.id, session]))
    return group.members.flatMap(member => {
        const session = byId.get(member.sessionId)
        return session ? [{ ...member, session }] : []
    }).sort((a, b) => Number(b.pinned) - Number(a.pinned))
}
