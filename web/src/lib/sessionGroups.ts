import type { SessionGroup } from '@hapi/protocol'
import type { SessionSummary } from '@/types/api'
import { isWorkingSession } from './navigationBadges'
import { classifySessionAttention } from './sessionAttention'

export type GroupSection = 'active' | 'working' | 'idle' | 'recent'

export function presentSessionGroup(
    group: SessionGroup,
    sessions: ReadonlyMap<string, SessionSummary>,
    lastSeenAt: (id: string) => number,
    manualUnreadAt: (id: string) => number | null,
) {
    const chats = group.members.flatMap(member => {
        const chat = sessions.get(member.sessionId)
        return chat && chat.metadata?.lifecycleState !== 'archived' ? [chat] : []
    })
    const questions = chats.filter(chat => (chat.pendingRequestsCount ?? 0) > 0 || (chat.pendingAsyncQuestionsCount ?? 0) > 0).length
    const unread = chats.filter(chat => classifySessionAttention(chat, {
        selected: false, lastSeenAt: lastSeenAt(chat.id), manualUnreadAt: manualUnreadAt(chat.id),
    })?.kind === 'unread').length
    const working = chats.filter(isWorkingSession).length
    const live = chats.filter(chat => chat.active)
    const flavors = [...new Set(live.flatMap(chat => chat.metadata?.flavor ? [chat.metadata.flavor] : []))].sort()
    const section: GroupSection = questions || unread ? 'active' : working ? 'working'
        : live.length || chats.some(chat => chat.metadata?.lifecycleState === 'parked') ? 'idle' : 'recent'
    return { chats, questions, unread, working, flavors, section,
        activityAt: Math.max(group.updatedAt, ...chats.map(chat => chat.lastAgentMessageAt ?? chat.updatedAt)) }
}
