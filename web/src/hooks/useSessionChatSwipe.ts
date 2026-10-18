import type { RefObject } from 'react'
import { useNavigate } from '@tanstack/react-router'
import type { ApiClient } from '@/api/client'
import type { SessionSummary } from '@/types/api'
import { getSessionGroupMembers } from '@/lib/sessionGroupMembers'
import { getSessionListSelectionNavigation, PRESERVE_SESSION_SIDEBAR_SCROLL } from '@/lib/sessionNavigation'
import { useSessionGroups } from './queries/useSessionGroups'
import { useHorizontalSwipe } from './useHorizontalSwipe'

export function useSessionChatSwipe(
    targetRef: RefObject<HTMLElement | null>,
    { api, sessionId, path, sessions }: {
        api: ApiClient; sessionId: string; path?: string; sessions: readonly SessionSummary[]
    },
) {
    const navigate = useNavigate()
    const { groups, query } = useSessionGroups(api)
    const group = groups.find(candidate => candidate.members.some(member => member.sessionId === sessionId))
    const members = group ? getSessionGroupMembers(group, sessions) : []
    const step = (offset: number) => {
        // Do not fall through to file navigation before membership is known.
        if (!query.isSuccess) return
        if (group) {
            const index = members.findIndex(member => member.sessionId === sessionId)
            const next = index >= 0 ? members[index + offset] : undefined
            if (next) void navigate(getSessionListSelectionNavigation(next.sessionId))
            return
        }
        if (offset < 0) {
            void navigate({ to: '/sessions', ...PRESERVE_SESSION_SIDEBAR_SCROLL })
        } else if (path) {
            void navigate({
                to: '/sessions/$sessionId/files', params: { sessionId },
                search: { tab: 'changes', display: 'diff' },
                ...PRESERVE_SESSION_SIDEBAR_SCROLL,
            })
        }
    }
    useHorizontalSwipe(targetRef, {
        onSwipeLeft: () => step(1),
        onSwipeRight: () => step(-1),
    })
}
