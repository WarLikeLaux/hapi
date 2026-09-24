import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useSessions } from '@/hooks/queries/useSessions'
import { useAppContext } from '@/lib/app-context'
import {
    countUnreadConversations,
    countWorkingSessions,
} from '@/lib/navigationBadges'
import { queryKeys } from '@/lib/query-keys'
import {
    getUnreadSessionCount,
    initializeSessionLastSeen,
    useSessionLastSeenVersion,
} from '@/lib/sessionLastSeen'
import { useTranslation } from '@/lib/use-translation'
import { cn } from '@/lib/utils'
import { prepareSidebarSessions } from '@/components/SessionList'

function AgentIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4" aria-hidden="true">
            <path d="M12 3v3M8 3h8M5 9h14v10H5z" />
            <path d="M8 13h.01M16 13h.01M9 17h6" />
        </svg>
    )
}

function ChatIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4" aria-hidden="true">
            <path d="M5 5h14v11H9l-4 3z" />
        </svg>
    )
}

function WorkingIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3 animate-spin-slow" aria-hidden="true">
            <line x1="12" y1="2" x2="12" y2="6" />
            <line x1="12" y1="18" x2="12" y2="22" />
            <line x1="4.93" y1="4.93" x2="7.76" y2="7.76" />
            <line x1="16.24" y1="16.24" x2="19.07" y2="19.07" />
            <line x1="2" y1="12" x2="6" y2="12" />
            <line x1="18" y1="12" x2="22" y2="12" />
            <line x1="4.93" y1="19.07" x2="7.76" y2="16.24" />
            <line x1="16.24" y1="7.76" x2="19.07" y2="4.93" />
        </svg>
    )
}

function formatBadgeCount(count: number): string {
    return count > 99 ? '99+' : String(count)
}

export function PrimarySectionNav() {
    const { t } = useTranslation()
    const { api, baseUrl } = useAppContext()
    const pathname = useLocation({ select: (location) => location.pathname })
    const active = pathname.startsWith('/chats') ? 'chats' : 'agents'
    const { sessions, isLoading: sessionsLoading, error: sessionsError } = useSessions(api)
    const [initializedHub, setInitializedHub] = useState<string | null>(null)
    const lastSeenVersion = useSessionLastSeenVersion()
    const conversations = useQuery({
        queryKey: queryKeys.externalConversations,
        queryFn: async () => (await api!.getExternalConversations()).conversations,
        enabled: Boolean(api)
    })
    const visibleSessions = useMemo(() => prepareSidebarSessions(sessions), [sessions])

    useEffect(() => {
        if (sessionsLoading || sessionsError) {
            return
        }
        initializeSessionLastSeen(baseUrl, visibleSessions)
        setInitializedHub(baseUrl)
    }, [baseUrl, sessionsError, sessionsLoading, visibleSessions])

    const unreadChatCount = countUnreadConversations(conversations.data ?? [])
    const unreadAgentCount = useMemo(
        () => initializedHub === baseUrl
            ? getUnreadSessionCount(visibleSessions)
            : 0,
        [baseUrl, initializedHub, lastSeenVersion, visibleSessions]
    )
    const workingAgentCount = useMemo(() => countWorkingSessions(visibleSessions), [visibleSessions])
    const itemClass = (selected: boolean) => cn(
        'flex min-w-0 flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-colors',
        selected
            ? 'bg-[var(--app-bg)] text-[var(--app-fg)] shadow-sm'
            : 'text-[var(--app-hint)] hover:text-[var(--app-fg)]'
    )

    return (
        <nav className="shrink-0 border-t border-[var(--app-border)] bg-[var(--app-subtle-bg)] p-1.5 pb-[max(.375rem,env(safe-area-inset-bottom))]" aria-label={t('nav.primary')}>
            <div className="mx-auto flex max-w-content rounded-xl bg-[var(--app-secondary-bg)] p-1">
                <Link to="/sessions" className={itemClass(active === 'agents')}>
                    <AgentIcon />
                    <span>{t('nav.agents')}</span>
                    {workingAgentCount > 0 ? (
                        <span
                            className="inline-flex min-w-5 items-center justify-center gap-1 rounded-full bg-[var(--app-badge-success-bg)] px-1.5 py-0.5 text-[10px] font-semibold leading-none text-[var(--app-badge-success-text)]"
                            title={t('session.item.running')}
                            aria-label={`${t('session.item.running')}: ${workingAgentCount}`}
                        >
                            <WorkingIcon />
                            {formatBadgeCount(workingAgentCount)}
                        </span>
                    ) : null}
                    {unreadAgentCount > 0 ? (
                        <span
                            className="min-w-5 rounded-full bg-[var(--app-button)] px-1.5 py-0.5 text-center text-[10px] font-semibold leading-none text-[var(--app-button-text)]"
                            title={t('session.item.newActivity')}
                            aria-label={`${t('session.item.newActivity')}: ${unreadAgentCount}`}
                        >
                            {formatBadgeCount(unreadAgentCount)}
                        </span>
                    ) : null}
                </Link>
                <Link to="/chats" className={itemClass(active === 'chats')}>
                    <ChatIcon />
                    <span>{t('nav.chats')}</span>
                    {unreadChatCount > 0 ? (
                        <span className="min-w-5 rounded-full bg-[var(--app-button)] px-1.5 py-0.5 text-center text-[10px] font-semibold leading-none text-[var(--app-button-text)]">
                            {formatBadgeCount(unreadChatCount)}
                        </span>
                    ) : null}
                </Link>
            </div>
        </nav>
    )
}
