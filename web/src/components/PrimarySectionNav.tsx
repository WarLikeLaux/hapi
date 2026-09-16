import { Link, useLocation } from '@tanstack/react-router'
import { useTranslation } from '@/lib/use-translation'
import { cn } from '@/lib/utils'

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

export function PrimarySectionNav() {
    const { t } = useTranslation()
    const pathname = useLocation({ select: (location) => location.pathname })
    const active = pathname.startsWith('/chats') ? 'chats' : 'agents'
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
                </Link>
                <Link to="/chats" className={itemClass(active === 'chats')}>
                    <ChatIcon />
                    <span>{t('nav.chats')}</span>
                </Link>
            </div>
        </nav>
    )
}
