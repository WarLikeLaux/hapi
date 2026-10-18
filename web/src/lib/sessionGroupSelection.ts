import type { SessionGroup } from '@hapi/protocol'
import type { SessionSummary } from '@/types/api'
import { classifySessionAttention } from './sessionAttention'
import { getSessionGroupMembers } from './sessionGroupMembers'
import { getSessionLastSeenAt, getSessionManualUnreadAt } from './sessionLastSeen'

function storageKey(scope: string, groupId: string): string {
    return `hapi.groupLastViewed.v1:${JSON.stringify([scope, groupId])}`
}

export function rememberGroupSession(scope: string, groupId: string, sessionId: string): void {
    try {
        window.localStorage.setItem(storageKey(scope, groupId), sessionId)
    } catch {
        // Navigation still works when browser storage is unavailable.
    }
}

/** Only used on group entry. Live attention changes must never retarget an open chat. */
export function getGroupEntrySession(scope: string, group: SessionGroup, sessions: readonly SessionSummary[]): string | null {
    const members = getSessionGroupMembers(group, sessions)
    // Keep tab order (including pins) within each attention category.
    const question = members.find(({ session }) => session.pendingRequestKinds?.includes('input')
        || (session.pendingAsyncQuestionsCount ?? 0) > 0)
    if (question) return question.sessionId
    const permission = members.find(({ session }) => session.pendingRequestKinds?.includes('permission'))
    if (permission) return permission.sessionId
    const unread = members.find(({ session }) => classifySessionAttention(session, {
        selected: false,
        lastSeenAt: getSessionLastSeenAt(session.id),
        manualUnreadAt: getSessionManualUnreadAt(session.id),
    })?.kind === 'unread')
    if (unread) return unread.sessionId

    try {
        const remembered = window.localStorage.getItem(storageKey(scope, group.id))
        if (members.some(member => member.sessionId === remembered)) return remembered
    } catch {
        // Fall back to the first available tab.
    }
    return members[0]?.sessionId ?? null
}
