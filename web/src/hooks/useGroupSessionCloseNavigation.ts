import { useEffect, useRef } from 'react'
import type { SessionGroup } from '@hapi/protocol'
import type { SessionSummary } from '@/types/api'

/** Follow a viewed group chat's archive transition, including when group detachment arrives first. */
export function useGroupSessionCloseNavigation(options: {
    scope: string
    sessionId: string | null
    session: SessionSummary | null
    groups: readonly SessionGroup[]
    onReturnToGroup: (groupId: string) => void
}): void {
    const observed = useRef<{ scope: string; sessionId: string | null; groupId: string | null } | null>(null)
    const { scope, sessionId, session, groups, onReturnToGroup } = options

    useEffect(() => {
        if (observed.current?.scope !== scope || observed.current.sessionId !== sessionId) {
            observed.current = { scope, sessionId, groupId: null }
        }
        if (!sessionId || !session) return
        const group = groups.find(g => g.members.some(member => member.sessionId === sessionId))
        if (group?.closed) {
            observed.current.groupId = null
            return
        }
        if (session.metadata?.lifecycleState !== 'archived') {
            if (group) observed.current.groupId = group.id
            return
        }
        // A direct link to already-archived history has no observed live group and stays open.
        const originId = observed.current.groupId
        observed.current.groupId = null
        if (originId && groups.some(g => g.id === originId)) onReturnToGroup(originId)
    }, [scope, sessionId, session, groups, onReturnToGroup])
}
