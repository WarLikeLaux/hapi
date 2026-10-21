import { useCallback, useEffect, useMemo } from 'react'
import { useLocation, useNavigate, useRouter } from '@tanstack/react-router'
import { PRESERVE_SESSION_SIDEBAR_SCROLL } from '@/lib/sessionNavigation'

/** A completed launch may open only from the visit that started it. */
export function useNewSessionNavigation() {
    const navigate = useNavigate()
    const { history } = useRouter()
    const locationKey = useLocation({ select: location => location.state.__TSR_key })
    const visit = useMemo(() => ({ location: history.location, active: true }), [history, locationKey])

    useEffect(() => {
        visit.active = history.location === visit.location
        // Back/forward can return to the same entry; that must not revive an old launch.
        const unsubscribe = history.subscribe(() => { visit.active = false })
        return () => { visit.active = false; unsubscribe() }
    }, [history, visit])

    return useCallback((sessionId: string) => {
        if (!visit.active || history.location !== visit.location) return
        // Keep the existing back-to-list history, guarding both steps of this transition.
        void navigate({ to: '/sessions', replace: true, ...PRESERVE_SESSION_SIDEBAR_SCROLL })
        const listLocation = history.location
        requestAnimationFrame(() => {
            if (history.location !== listLocation || listLocation.pathname !== '/sessions') return
            void navigate({ to: '/sessions/$sessionId', params: { sessionId }, ...PRESERVE_SESSION_SIDEBAR_SCROLL })
        })
    }, [history, navigate, visit])
}
