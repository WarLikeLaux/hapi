import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { ExternalConversation } from '@hapi/protocol/messengers'
import type { ApiClient } from '@/api/client'
import { cn } from '@/lib/utils'

const providers: Record<string, { label: string; accent: string; badge: string }> = {
    telegram: { label: 'Telegram', accent: 'bg-[#2AABEE]/15 text-[#229ED9]', badge: 'bg-[#229ED9]' },
    yandex: { label: 'Yandex', accent: 'bg-[#FC3F1D]/15 text-[#FC3F1D]', badge: 'bg-[#FC3F1D]' },
    max: { label: 'MAX', accent: 'bg-[#6654D9]/15 text-[#6654D9]', badge: 'bg-[#6654D9]' },
}

export function ProviderMark({ provider, className }: { provider: string; className?: string }) {
    return (
        <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
            {provider === 'telegram' ? (
                <path d="M21.7 3.5 18.6 20c-.2 1.2-.9 1.5-1.9.9l-4.7-3.5-2.3 2.2c-.3.3-.5.5-1 .5l.3-4.8 8.8-8c.4-.3-.1-.5-.6-.2L6.3 14 1.6 12.5c-1-.3-1-1 .2-1.5L20.2 3.9c.9-.3 1.7.2 1.5-.4Z" />
            ) : provider === 'yandex' ? (
                <path d="M18 3h-6.1C7.9 3 5.5 5.2 5.5 8.7c0 2.6 1.3 4.3 3.7 5.4L5 21h3.8l4.7-8H12c-2 0-3.2-1.5-3.2-4.3 0-2.1 1.1-3.2 3.2-3.2h2.7V21H18Z" />
            ) : provider === 'max' ? (
                <path d="M12 2a10 10 0 0 0-8.7 15l-1 4.5 4.5-1A10 10 0 1 0 12 2Zm0 4a6 6 0 1 1-4.7 9.7l-.3 1.1-.1-1.4A6 6 0 0 1 12 6Z" />
            ) : null}
        </svg>
    )
}

export function useConversationAvatarUrl(
    api: ApiClient | null,
    conversation: ExternalConversation | undefined,
    visible = true
): string | null {
    const id = conversation?.id
    const version = conversation?.avatarVersion
    const { data: blob } = useQuery({
        queryKey: ['external-conversation-avatar', id, version],
        queryFn: ({ signal }) => api!.getExternalConversationAvatar(id!, version!, signal),
        enabled: Boolean(api && id && version && visible),
        staleTime: Infinity,
        retry: false,
    })
    const [objectUrl, setObjectUrl] = useState<{ blob: Blob; url: string } | null>(null)
    useEffect(() => {
        if (!blob) return
        const url = URL.createObjectURL(blob)
        setObjectUrl({ blob, url })
        return () => URL.revokeObjectURL(url)
    }, [blob])
    return conversation?.avatarDataUrl || (objectUrl && objectUrl.blob === blob ? objectUrl.url : null)
}

export function ConversationAvatar({ conversation, className, api = null }: {
    conversation: ExternalConversation
    className?: string
    api?: ApiClient | null
}) {
    const provider = providers[conversation.provider]
    const title = conversation.customTitle?.trim() || conversation.sourceTitle?.trim() || conversation.title
    const element = useRef<HTMLSpanElement>(null)
    const [visible, setVisible] = useState(false)
    useEffect(() => {
        if (!conversation.avatarVersion || visible || !element.current) return
        if (typeof IntersectionObserver === 'undefined') {
            setVisible(true)
            return
        }
        const observer = new IntersectionObserver((entries) => {
            if (entries.some(entry => entry.isIntersecting)) {
                setVisible(true)
                observer.disconnect()
            }
        }, { rootMargin: '64px' })
        observer.observe(element.current)
        return () => observer.disconnect()
    }, [conversation.avatarVersion, visible])
    const src = useConversationAvatarUrl(api, conversation, visible)
    return (
        <span ref={element} className={cn('relative block h-10 w-10 shrink-0 text-xs', className)}>
            <span className={cn(
                'flex h-full w-full items-center justify-center overflow-hidden rounded-full font-semibold',
                provider?.accent ?? 'bg-[var(--app-secondary-bg)] text-[var(--app-hint)]'
            )} aria-hidden="true">
                {src
                    ? <img src={src} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
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
