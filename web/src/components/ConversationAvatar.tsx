import type { ExternalConversation } from '@hapi/protocol/messengers'
import { cn } from '@/lib/utils'

const providers: Record<string, { label: string; accent: string; badge: string }> = {
    telegram: { label: 'Telegram', accent: 'bg-[#2AABEE]/15 text-[#229ED9]', badge: 'bg-[#229ED9]' },
    yandex: { label: 'Yandex', accent: 'bg-[#FC3F1D]/15 text-[#FC3F1D]', badge: 'bg-[#FC3F1D]' },
}

export function ProviderMark({ provider, className }: { provider: string; className?: string }) {
    return (
        <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
            {provider === 'telegram' ? (
                <path d="M21.7 3.5 18.6 20c-.2 1.2-.9 1.5-1.9.9l-4.7-3.5-2.3 2.2c-.3.3-.5.5-1 .5l.3-4.8 8.8-8c.4-.3-.1-.5-.6-.2L6.3 14 1.6 12.5c-1-.3-1-1 .2-1.5L20.2 3.9c.9-.3 1.7.2 1.5-.4Z" />
            ) : provider === 'yandex' ? (
                <path d="M18 3h-6.1C7.9 3 5.5 5.2 5.5 8.7c0 2.6 1.3 4.3 3.7 5.4L5 21h3.8l4.7-8H12c-2 0-3.2-1.5-3.2-4.3 0-2.1 1.1-3.2 3.2-3.2h2.7V21H18Z" />
            ) : null}
        </svg>
    )
}

export function ConversationAvatar({ conversation, className }: {
    conversation: ExternalConversation
    className?: string
}) {
    const provider = providers[conversation.provider]
    const title = conversation.customTitle?.trim() || conversation.sourceTitle?.trim() || conversation.title
    return (
        <span className={cn('relative block h-10 w-10 shrink-0 text-xs', className)}>
            <span className={cn(
                'flex h-full w-full items-center justify-center overflow-hidden rounded-full font-semibold',
                provider?.accent ?? 'bg-[var(--app-secondary-bg)] text-[var(--app-hint)]'
            )} aria-hidden="true">
                {conversation.avatarDataUrl
                    ? <img src={conversation.avatarDataUrl} alt="" className="h-full w-full object-cover" />
                    : title.trim().slice(0, 2).toUpperCase() || '··'}
            </span>
            {provider ? (
                <span
                    role="img"
                    aria-label={provider.label}
                    title={provider.label}
                    className={cn(
                        'absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full border-2 border-[var(--app-bg)] text-white',
                        provider.badge
                    )}
                >
                    <ProviderMark provider={conversation.provider} className="h-2.5 w-2.5" />
                </span>
            ) : null}
        </span>
    )
}
