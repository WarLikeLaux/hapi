import type { ReactNode } from 'react'

export const SESSION_LIST_ITEM_CLASS = 'session-list-item group/session-row flex w-full flex-col gap-1 py-2 pl-0 pr-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)] select-none rounded-lg'

export function SessionRowLayout(props: {
    avatar: ReactNode
    title: string
    active: boolean
    indicators?: ReactNode
    trailing?: ReactNode
    children?: ReactNode
    className?: string
}) {
    return (
        <div className={`flex w-full min-w-0 items-center gap-2.5 ${props.className ?? ''}`}>
            <span className={`relative flex h-9 w-9 shrink-0 items-center justify-center text-[var(--app-fg)] ${!props.active ? 'opacity-50' : ''}`}>
                {props.avatar}
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className={`grid grid-cols-[minmax(0,1fr)_minmax(0,max-content)] items-center gap-2 ${!props.active ? 'opacity-50' : ''}`}>
                    <div className="flex min-w-0 items-center gap-2">
                        <div className={`min-w-0 flex-1 truncate text-sm font-medium ${props.active ? 'text-[var(--app-fg)]' : 'text-[var(--app-hint)]'}`} title={props.title}>
                            {props.title}
                        </div>
                        {props.indicators}
                    </div>
                    <div className="flex min-w-0 items-center justify-end gap-2 overflow-hidden text-xs">
                        {props.trailing}
                    </div>
                </div>
                {props.children}
            </div>
        </div>
    )
}

export function SessionWorkingIcon() {
    return (
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5 shrink-0 animate-spin-slow text-[var(--app-badge-success-text)]">
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
