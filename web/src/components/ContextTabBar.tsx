import { useTranslation } from '@/lib/use-translation'
import {
    SESSION_CONTEXTS,
    type ContextTabStats,
    type SessionContextId,
} from '@/lib/sessionContexts'
import { cn } from '@/lib/utils'

function WorkingIcon(props: { className?: string }) {
    return (
        <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className ?? 'h-2.5 w-2.5 animate-spin-slow'}
            aria-hidden="true"
        >
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

const chipBaseClass =
    'inline-flex min-h-7 shrink-0 items-center justify-center gap-0.5 rounded-full border px-2 py-0.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)] cursor-pointer select-none sm:justify-start sm:gap-1.5 sm:px-2.5'

const chipSelectedClass =
    'border-[var(--app-link)] bg-[var(--app-link)]/10 text-[var(--app-link)] font-semibold shadow-sm'

const chipIdleClass =
    'border-[var(--app-border)] bg-[var(--app-subtle-bg)] text-[var(--app-hint)] hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]'

export interface ContextTabBarProps {
    activeContext: SessionContextId
    onSelectContext: (id: SessionContextId) => void
    stats: Record<SessionContextId, ContextTabStats>
    className?: string
}

export function ContextTabBar(props: ContextTabBarProps) {
    const { t } = useTranslation()

    return (
        <div
            role="tablist"
            aria-label={t('sessions.context.tabsLabel')}
            className={cn(
                'flex items-center gap-1 pl-4 pr-2 pb-1.5 overflow-x-auto scrollbar-none',
                props.className
            )}
        >
            {SESSION_CONTEXTS.map((ctx) => {
                const isSelected = props.activeContext === ctx.id
                const tabStats = props.stats[ctx.id] ?? { totalCount: 0, workingCount: 0, unreadCount: 0 }
                const label = t(ctx.labelKey)

                // Tooltip text
                const details: string[] = []
                if (tabStats.activeCount > 0) details.push(`${tabStats.activeCount} active`)
                if (tabStats.workingCount > 0) details.push(`${tabStats.workingCount} working`)
                if (tabStats.unreadCount > 0) details.push(`${tabStats.unreadCount} unread`)
                if (details.length === 0 && tabStats.totalCount > 0) details.push(`${tabStats.totalCount} total`)
                const title = details.length > 0 ? `${label} (${details.join(', ')})` : label

                return (
                    <button
                        key={ctx.id}
                        type="button"
                        role="tab"
                        aria-selected={isSelected}
                        aria-label={title}
                        onClick={() => props.onSelectContext(ctx.id)}
                        className={cn(chipBaseClass, isSelected ? chipSelectedClass : chipIdleClass)}
                        title={title}
                    >
                        <span
                            className="inline-flex size-4 shrink-0 items-center justify-center text-sm leading-none"
                            aria-hidden="true"
                        >
                            {ctx.icon}
                        </span>
                        <span className="hidden truncate sm:inline">{label}</span>

                        {tabStats.workingCount > 0 ? (
                            <span
                                className="inline-flex items-center gap-0.5 rounded-full bg-[var(--app-badge-success-bg)] px-1.5 py-0.5 text-[10px] font-semibold leading-none text-[var(--app-badge-success-text)]"
                                aria-label={`${tabStats.workingCount} working`}
                            >
                                <WorkingIcon />
                                <span>{tabStats.workingCount}</span>
                            </span>
                        ) : null}

                        {tabStats.unreadCount > 0 ? (
                            <span
                                className="inline-flex min-w-4 items-center justify-center rounded-full bg-[var(--app-button)] px-1 py-0.5 text-[10px] font-semibold leading-none text-[var(--app-button-text)]"
                                aria-label={`${tabStats.unreadCount} unread`}
                            >
                                {tabStats.unreadCount > 99 ? '99+' : tabStats.unreadCount}
                            </span>
                        ) : null}
                    </button>
                )
            })}
        </div>
    )
}
