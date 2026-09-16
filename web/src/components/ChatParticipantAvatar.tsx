import { cn } from '@/lib/utils'

type ChatParticipantAvatarProps = {
    src?: string | null
    name?: string | null
    currentUser?: boolean
    className?: string
}

function initials(name: string | null | undefined): string {
    const parts = name?.trim().split(/\s+/).filter(Boolean) ?? []
    if (parts.length === 0) return ''
    return parts.slice(0, 2).map((part) => Array.from(part)[0]).join('').toUpperCase()
}

export function ChatParticipantAvatar(props: ChatParticipantAvatarProps) {
    return (
        <div
            aria-hidden="true"
            className={cn(
                'flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full',
                'border border-[var(--app-border)] bg-[var(--app-secondary-bg)] text-[10px] font-semibold text-[var(--app-hint)]',
                props.className
            )}
        >
            {props.src ? (
                <img src={props.src} alt="" className="h-full w-full object-cover" />
            ) : props.currentUser ? (
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <circle cx="12" cy="8" r="3.25" />
                    <path d="M5.5 20c.5-4 2.7-6 6.5-6s6 2 6.5 6" />
                </svg>
            ) : (
                initials(props.name) || '?'
            )}
        </div>
    )
}
