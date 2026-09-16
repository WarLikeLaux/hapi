import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Outlet, useLocation, useNavigate, useParams } from '@tanstack/react-router'
import type { ExternalConversation, ExternalMedia, ExternalMessagesResponse, MessengerConnection, SubmitMessengerAuthRequest } from '@hapi/protocol/messengers'
import { ExternalMessageText } from '@/components/ExternalMessageText'
import { ImagePreview } from '@/components/ImagePreview'
import { PrimarySectionNav } from '@/components/PrimarySectionNav'
import { RoundVideoPlayer } from '@/components/RoundVideoPlayer'
import { ChatParticipantAvatar } from '@/components/ChatParticipantAvatar'
import { getUserBubbleClassName } from '@/components/AssistantChat/messages/user-bubble'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { useSidebarResize } from '@/hooks/useSidebarResize'
import { useChatKeyboardTail } from '@/hooks/useChatKeyboardTail'
import { useExternalMessagePrefetch } from '@/hooks/useExternalMessagePrefetch'
import { useExternalMessages } from '@/hooks/queries/useExternalMessages'
import { useAppContext } from '@/lib/app-context'
import { imageFileFromClipboard } from '@/lib/clipboardMedia'
import { upsertMessengerConnection } from '@/lib/messengerConnections'
import { queryKeys } from '@/lib/query-keys'
import { useTranslation } from '@/lib/use-translation'
import { cn } from '@/lib/utils'
import { formatMessageTimestamp } from '@/chat/presentation'
import { areExternalMessagesGrouped } from '@/chat/messageGrouping'
import { shouldAutoLoadExternalMedia } from '@/chat/externalMedia'
import {
    appendOptimisticExternalMessage,
    createOptimisticExternalMessage,
    getOptimisticExternalSender,
    isOptimisticExternalMessage,
    removeOptimisticExternalMessage
} from '@/chat/optimisticExternalMessages'

function TelegramMark(props: { className?: string }) {
    return (
        <svg viewBox="0 0 24 24" className={props.className} fill="currentColor" aria-hidden="true">
            <path d="M21.7 3.5 18.6 20c-.2 1.2-.9 1.5-1.9.9l-4.7-3.5-2.3 2.2c-.3.3-.5.5-1 .5l.3-4.8 8.8-8c.4-.3-.1-.5-.6-.2L6.3 14 1.6 12.5c-1-.3-1-1 .2-1.5L20.2 3.9c.9-.3 1.7.2 1.5-.4Z" />
        </svg>
    )
}

function SettingsIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5" aria-hidden="true">
            <circle cx="12" cy="12" r="3" />
            <path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.4 1a8 8 0 0 0-1.7-1L14.5 3h-5L9 6a8 8 0 0 0-1.7 1L5 6.1l-2 3.4L5 11a7 7 0 0 0 0 2l-2 1.5 2 3.4 2.4-1a8 8 0 0 0 1.7 1l.4 3h5l.4-3a8 8 0 0 0 1.7-1l2.4 1 2-3.4-2-1.5a7 7 0 0 0 .1-1Z" />
        </svg>
    )
}

function BackIcon() {
    return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5"><path d="m15 18-6-6 6-6" /></svg>
}

function SendIcon() {
    return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5"><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></svg>
}

function AttachmentIcon() {
    return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5" aria-hidden="true"><path d="m21.4 11.6-8.9 8.9a6 6 0 0 1-8.5-8.5l9.6-9.6a4 4 0 0 1 5.7 5.7l-9.6 9.6a2 2 0 1 1-2.8-2.8l8.9-8.9" /></svg>
}

function formatTime(value: number | null): string {
    if (!value) return ''
    return formatMessageTimestamp(new Date(value))
}

function ConversationAvatar({ conversation }: { conversation: ExternalConversation }) {
    const initials = conversation.title.trim().slice(0, 2).toUpperCase() || 'TG'
    return (
        <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#2AABEE]/15 text-xs font-semibold text-[#229ED9]">
            {conversation.avatarDataUrl
                ? <img src={conversation.avatarDataUrl} alt="" className="h-full w-full object-cover" />
                : initials}
        </div>
    )
}

const mediaLabels: Record<ExternalMedia['kind'], string> = {
    image: 'Photo',
    video: 'Video',
    audio: 'Audio',
    voice: 'Voice message',
    sticker: 'Sticker',
    file: 'File',
    location: 'Location',
    contact: 'Contact',
    poll: 'Poll',
    other: 'Attachment'
}

const mediaIcons: Record<ExternalMedia['kind'], string> = {
    image: '▧',
    video: '▶',
    audio: '♫',
    voice: '◖))',
    sticker: '✦',
    file: '▤',
    location: '⌖',
    contact: '●',
    poll: '≡',
    other: '＋'
}

function formatMediaSize(size: number | null): string | null {
    if (size === null) return null
    if (size < 1024) return `${size} B`
    if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`
    return `${(size / 1024 / 1024).toFixed(1)} MB`
}

function MediaAttachment(props: {
    media: ExternalMedia
    galleryId: string
    conversationId: string
    providerMessageId: string
    mediaIndex: number
}) {
    const { api } = useAppContext()
    const { media } = props
    const [fullUrl, setFullUrl] = useState<string | null>(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const previewRef = useRef<HTMLElement>(null)
    const downloadable = ['image', 'video', 'audio', 'voice', 'sticker', 'file'].includes(media.kind)
    const hasVisualPreview = Boolean(media.thumbnailDataUrl)
        && (media.kind === 'image' || media.kind === 'video' || media.kind === 'sticker')
    const autoLoadsOriginal = shouldAutoLoadExternalMedia(media)

    useEffect(() => () => {
        if (fullUrl) URL.revokeObjectURL(fullUrl)
    }, [fullUrl])

    const loadOriginal = useCallback(async () => {
        if (!api || loading || fullUrl || !downloadable) return
        setLoading(true)
        setError(null)
        try {
            const blob = await api.getExternalMediaBlob(
                props.conversationId,
                props.providerMessageId,
                props.mediaIndex
            )
            setFullUrl(URL.createObjectURL(blob))
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Failed to load media')
        } finally {
            setLoading(false)
        }
    }, [api, downloadable, fullUrl, loading, props.conversationId, props.mediaIndex, props.providerMessageId])

    useEffect(() => {
        if (error || fullUrl || loading || !autoLoadsOriginal) return
        const preview = previewRef.current
        if (!preview) return
        if (typeof IntersectionObserver === 'undefined') {
            void loadOriginal()
            return
        }
        const observer = new IntersectionObserver((entries) => {
            if (!entries.some((entry) => entry.isIntersecting)) return
            observer.disconnect()
            void loadOriginal()
        }, { rootMargin: '500px 0px' })
        observer.observe(preview)
        return () => observer.disconnect()
    }, [autoLoadsOriginal, error, fullUrl, loadOriginal, loading])

    const label = mediaLabels[media.kind]
    if (fullUrl && (media.kind === 'image' || media.kind === 'sticker')) {
        return (
            <ImagePreview
                src={fullUrl}
                fileName={media.fileName ?? label}
                label={label}
                galleryId={props.galleryId}
                buttonClassName="group relative flex w-[min(82vw,30rem)] cursor-zoom-in items-center justify-center overflow-hidden rounded-xl bg-black/10"
                imageClassName="max-h-[32rem] w-full object-contain transition-transform group-hover:scale-[1.01]"
            />
        )
    }
    if (fullUrl && media.kind === 'video') {
        if (media.isRound) {
            return <RoundVideoPlayer src={fullUrl} label={media.fileName ?? label} />
        }
        return <video src={fullUrl} controls={!media.isAnimated} autoPlay={media.isAnimated} loop={media.isAnimated} muted={media.isAnimated} playsInline preload="metadata" className="max-h-[32rem] max-w-[min(82vw,30rem)] rounded-xl bg-black object-contain" />
    }
    if (fullUrl && (media.kind === 'audio' || media.kind === 'voice')) {
        return <audio src={fullUrl} controls preload="metadata" className="max-w-[82vw]" />
    }
    if (fullUrl && media.kind === 'file') {
        return <a href={fullUrl} download={media.fileName ?? 'attachment'} className="rounded-xl border border-[var(--app-border)] bg-[var(--app-subtle-bg)] px-4 py-3 text-sm text-[var(--app-link)]">Download {media.fileName ?? 'file'}</a>
    }

    if (hasVisualPreview) {
        return (
            <button ref={(node) => { previewRef.current = node }} type="button" onClick={() => void loadOriginal()} disabled={loading} className={cn('group relative flex cursor-pointer items-center justify-center overflow-hidden bg-black/10 disabled:cursor-wait', media.isRound ? 'h-[min(16rem,78vw)] w-[min(16rem,78vw)] rounded-full' : 'w-[min(82vw,24rem)] rounded-xl')}>
                <img src={media.thumbnailDataUrl!} alt={label} className={cn('w-full transition-opacity', media.isRound ? 'h-full object-cover' : 'max-h-80 min-h-36 object-contain', loading && 'opacity-70')} />
                {loading || error || media.kind === 'video' ? <span className="absolute inset-0 grid place-items-center bg-black/20 text-center text-sm font-medium text-white opacity-100 drop-shadow transition-opacity sm:opacity-0 sm:group-hover:opacity-100 group-disabled:opacity-100">{loading ? 'Loading original…' : error ? 'Tap to retry' : '▶ Play video'}</span> : null}
            </button>
        )
    }
    const size = formatMediaSize(media.size)
    const fallbackContent = (
        <>
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--app-bg)] text-base text-[var(--app-link)]">{mediaIcons[media.kind]}</span>
            <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{loading || autoLoadsOriginal ? 'Loading…' : media.fileName ?? mediaLabels[media.kind]}</span>
                {size || media.mimeType ? <span className="block truncate text-[10px] text-[var(--app-hint)]">{[size, media.mimeType].filter(Boolean).join(' · ')}</span> : null}
                {error ? <span className="block text-[10px] text-red-600">{error}</span> : null}
            </span>
        </>
    )
    const fallbackClassName = 'flex min-w-48 items-center gap-3 rounded-xl border border-[var(--app-border)] bg-[var(--app-subtle-bg)] px-3 py-2.5 text-left'
    if (downloadable) {
        return <button ref={(node) => { previewRef.current = node }} type="button" onClick={() => void loadOriginal()} className={fallbackClassName}>{fallbackContent}</button>
    }
    return <div ref={(node) => { previewRef.current = node }} className={fallbackClassName}>{fallbackContent}</div>
}

function ConnectionDialog(props: { connection: MessengerConnection; onClose: () => void }) {
    const { api } = useAppContext()
    const { t } = useTranslation()
    const queryClient = useQueryClient()
    const [apiId, setApiId] = useState('')
    const [apiHash, setApiHash] = useState('')
    const [authValue, setAuthValue] = useState('')
    const [selected, setSelected] = useState<Set<string>>(new Set())
    const [candidateSearch, setCandidateSearch] = useState('')
    const [error, setError] = useState<string | null>(null)
    const ready = props.connection.state === 'ready'
    const cacheConnection = (connection: MessengerConnection) => {
        queryClient.setQueryData<MessengerConnection[]>(
            queryKeys.messengerConnections,
            (current) => upsertMessengerConnection(current, connection)
        )
    }
    const candidates = useQuery({
        queryKey: queryKeys.messengerCandidates('telegram'),
        queryFn: async () => (await api!.getMessengerCandidates('telegram')).conversations,
        enabled: Boolean(api && ready)
    })
    const visibleCandidates = useMemo(() => {
        const query = candidateSearch.trim().toLocaleLowerCase()
        if (!query) return candidates.data ?? []
        return (candidates.data ?? []).filter((conversation) => conversation.title.toLocaleLowerCase().includes(query))
    }, [candidateSearch, candidates.data])

    useEffect(() => {
        if (candidates.data) {
            setSelected(new Set(candidates.data.filter((item) => item.selected).map((item) => item.remoteId)))
        }
    }, [candidates.data])

    const configure = useMutation({
        mutationFn: async () => api!.configureTelegram({ apiId: Number(apiId), apiHash }),
        onSuccess: ({ connection }) => {
            cacheConnection(connection)
            setError(null)
        },
        onError: (cause) => setError(cause instanceof Error ? cause.message : t('dialog.error.default'))
    })
    const submitAuth = useMutation({
        mutationFn: async (input: SubmitMessengerAuthRequest) => api!.submitMessengerAuth('telegram', input),
        onSuccess: ({ connection }) => {
            cacheConnection(connection)
            setAuthValue('')
            setError(null)
        },
        onError: (cause) => setError(cause instanceof Error ? cause.message : t('dialog.error.default'))
    })
    const saveSelection = useMutation({
        mutationFn: async () => api!.selectMessengerConversations('telegram', { remoteIds: [...selected] }),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: queryKeys.externalConversations })
            props.onClose()
        },
        onError: (cause) => setError(cause instanceof Error ? cause.message : t('dialog.error.default'))
    })

    const authKind = props.connection.state.replace('awaiting_', '') as SubmitMessengerAuthRequest['kind']
    const authLabel = authKind === 'phone'
        ? t('chats.telegram.phone')
        : authKind === 'code'
            ? t('chats.telegram.code')
            : t('chats.telegram.password')

    return (
        <Dialog open onOpenChange={(open) => { if (!open) props.onClose() }}>
            <DialogContent className="max-h-[88dvh] overflow-hidden border border-[var(--app-border)] bg-[var(--app-bg)] p-0">
                <DialogDescription className="sr-only">{t('chats.select.hint')}</DialogDescription>
                <div className="flex items-center gap-3 border-b border-[var(--app-border)] px-4 py-3 pr-14">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#2AABEE] text-white"><TelegramMark className="h-5 w-5" /></div>
                    <div className="min-w-0 flex-1">
                        <DialogTitle className="font-semibold">Telegram</DialogTitle>
                        <div className="truncate text-xs text-[var(--app-hint)]">{props.connection.accountLabel ?? t(`chats.connection.${props.connection.state}`)}</div>
                    </div>
                </div>

                <div className="max-h-[calc(88dvh-4rem)] overflow-y-auto p-4">
                    {ready ? (
                        <>
                            <p className="mb-3 text-sm text-[var(--app-hint)]">{t('chats.select.hint')}</p>
                            {candidates.isLoading ? <div className="py-8 text-center text-sm text-[var(--app-hint)]">{t('loading')}</div> : null}
                            {candidates.error ? <div className="mb-3 text-sm text-red-600">{candidates.error.message}</div> : null}
                            {candidates.data ? (
                                <input
                                    value={candidateSearch}
                                    onChange={(event) => setCandidateSearch(event.target.value)}
                                    placeholder="Search recent chats"
                                    className="mb-3 w-full rounded-xl border border-[var(--app-border)] bg-[var(--app-secondary-bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--app-link)]"
                                />
                            ) : null}
                            <div className="space-y-1">
                                {visibleCandidates.map((conversation) => (
                                    <label key={conversation.id} className="flex cursor-pointer items-center gap-3 rounded-xl px-2 py-2 hover:bg-[var(--app-subtle-bg)]">
                                        <input
                                            type="checkbox"
                                            checked={selected.has(conversation.remoteId)}
                                            onChange={(event) => setSelected((current) => {
                                                const next = new Set(current)
                                                if (event.target.checked) next.add(conversation.remoteId)
                                                else next.delete(conversation.remoteId)
                                                return next
                                            })}
                                            className="h-4 w-4 accent-[var(--app-link)]"
                                        />
                                        <ConversationAvatar conversation={conversation} />
                                        <span className="min-w-0 flex-1 truncate text-sm">{conversation.title}</span>
                                    </label>
                                ))}
                            </div>
                            <button
                                type="button"
                                disabled={saveSelection.isPending}
                                onClick={() => saveSelection.mutate()}
                                className="mt-4 w-full rounded-xl bg-[var(--app-button)] px-4 py-2.5 text-sm font-medium text-[var(--app-button-text)] disabled:opacity-50"
                            >
                                {saveSelection.isPending ? t('chats.saving') : t('chats.saveSelection')}
                            </button>
                        </>
                    ) : props.connection.state.startsWith('awaiting_') ? (
                        <form onSubmit={(event) => {
                            event.preventDefault()
                            submitAuth.mutate({ kind: authKind, value: authValue })
                        }}>
                            <label className="mb-1 block text-sm font-medium">{authLabel}</label>
                            <input
                                autoFocus
                                type={authKind === 'password' ? 'password' : 'text'}
                                value={authValue}
                                onChange={(event) => setAuthValue(event.target.value)}
                                placeholder={authKind === 'phone' ? '+79991234567' : undefined}
                                className="w-full rounded-xl border border-[var(--app-border)] bg-[var(--app-secondary-bg)] px-3 py-2.5 outline-none focus:border-[var(--app-link)]"
                            />
                            <button type="submit" disabled={!authValue || submitAuth.isPending} className="mt-3 w-full rounded-xl bg-[var(--app-button)] px-4 py-2.5 text-sm font-medium text-[var(--app-button-text)] disabled:opacity-50">
                                {submitAuth.isPending ? t('chats.connecting') : t('chats.continue')}
                            </button>
                        </form>
                    ) : props.connection.state === 'starting' ? (
                        <div className="py-10 text-center text-sm text-[var(--app-hint)]">{t('chats.connection.starting')}</div>
                    ) : (
                        <form onSubmit={(event) => {
                            event.preventDefault()
                            configure.mutate()
                        }}>
                            <p className="mb-4 text-sm text-[var(--app-hint)]">{t('chats.telegram.credentialsHint')}</p>
                            <label className="mb-1 block text-sm font-medium">API ID</label>
                            <input value={apiId} onChange={(event) => setApiId(event.target.value.replace(/\D/g, ''))} inputMode="numeric" className="mb-3 w-full rounded-xl border border-[var(--app-border)] bg-[var(--app-secondary-bg)] px-3 py-2.5 outline-none focus:border-[var(--app-link)]" />
                            <label className="mb-1 block text-sm font-medium">API Hash</label>
                            <input value={apiHash} onChange={(event) => setApiHash(event.target.value)} className="w-full rounded-xl border border-[var(--app-border)] bg-[var(--app-secondary-bg)] px-3 py-2.5 outline-none focus:border-[var(--app-link)]" />
                            <button type="submit" disabled={!apiId || !apiHash || configure.isPending} className="mt-3 w-full rounded-xl bg-[var(--app-button)] px-4 py-2.5 text-sm font-medium text-[var(--app-button-text)] disabled:opacity-50">
                                {configure.isPending ? t('chats.connecting') : t('chats.connectTelegram')}
                            </button>
                        </form>
                    )}
                    {props.connection.detail ? <div className="mt-3 rounded-xl bg-[var(--app-subtle-bg)] p-3 text-xs text-[var(--app-hint)]">{props.connection.detail}</div> : null}
                    {error ? <div className="mt-3 text-sm text-red-600">{error}</div> : null}
                </div>
            </DialogContent>
        </Dialog>
    )
}

function ChatList(props: {
    conversations: ExternalConversation[]
    selectedId: string | null
    onManage: () => void
}) {
    const { t } = useTranslation()
    const navigate = useNavigate()
    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex h-14 shrink-0 items-center gap-3 border-b border-[var(--app-border)] px-4">
                <div className="flex-1 text-lg font-semibold">{t('chats.title')}</div>
                <button type="button" onClick={props.onManage} title={t('chats.manage')} className="rounded-full p-2 text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)]"><SettingsIcon /></button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
                {props.conversations.length === 0 ? (
                    <button type="button" onClick={props.onManage} className="mx-auto mt-16 block max-w-xs rounded-2xl border border-dashed border-[var(--app-border)] px-6 py-8 text-center">
                        <TelegramMark className="mx-auto mb-3 h-8 w-8 text-[#229ED9]" />
                        <span className="block text-sm font-medium">{t('chats.empty.title')}</span>
                        <span className="mt-1 block text-xs text-[var(--app-hint)]">{t('chats.empty.hint')}</span>
                    </button>
                ) : props.conversations.map((conversation) => (
                    <button
                        type="button"
                        key={conversation.id}
                        onClick={() => navigate({ to: '/chats/$conversationId', params: { conversationId: conversation.id } })}
                        className={cn(
                            'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors',
                            props.selectedId === conversation.id ? 'bg-[var(--app-secondary-bg)]' : 'hover:bg-[var(--app-subtle-bg)]'
                        )}
                    >
                        <ConversationAvatar conversation={conversation} />
                        <span className="min-w-0 flex-1">
                            <span className="flex items-baseline gap-2">
                                <span className="min-w-0 flex-1 truncate text-sm font-medium">{conversation.title}</span>
                                {conversation.unreadCount > 0 ? <span className="min-w-5 rounded-full bg-[var(--app-button)] px-1.5 py-0.5 text-center text-[10px] font-semibold text-[var(--app-button-text)]">{conversation.unreadCount > 99 ? '99+' : conversation.unreadCount}</span> : null}
                                <span className="shrink-0 text-[10px] text-[var(--app-hint)]">{formatTime(conversation.lastMessageAt)}</span>
                            </span>
                            <span className="mt-0.5 block truncate text-xs text-[var(--app-hint)]">{conversation.lastMessagePreview ?? t('chats.noMessages')}</span>
                        </span>
                    </button>
                ))}
            </div>
        </div>
    )
}

export function ChatsPage() {
    const { api } = useAppContext()
    const pathname = useLocation({ select: (location) => location.pathname })
    const sidebar = useSidebarResize()
    const [manageOpen, setManageOpen] = useState(false)
    const selectedId = pathname.startsWith('/chats/') ? decodeURIComponent(pathname.slice('/chats/'.length).split('/')[0]) : null
    const isIndex = pathname === '/chats' || pathname === '/chats/'
    const connections = useQuery({
        queryKey: queryKeys.messengerConnections,
        queryFn: async () => (await api!.getMessengerConnections()).connections,
        enabled: Boolean(api),
        refetchInterval: (query) => {
            const state = query.state.data?.find((item) => item.provider === 'telegram')?.state
            return state === 'starting' || state?.startsWith('awaiting_') ? 1500 : false
        }
    })
    const conversations = useQuery({
        queryKey: queryKeys.externalConversations,
        queryFn: async () => (await api!.getExternalConversations()).conversations,
        enabled: Boolean(api)
    })
    useExternalMessagePrefetch(api, conversations.data)
    const telegram = connections.data?.find((item) => item.provider === 'telegram') ?? {
        provider: 'telegram', state: 'unconfigured', accountLabel: null, detail: null
    } satisfies MessengerConnection

    useEffect(() => {
        if (telegram.state.startsWith('awaiting_')) setManageOpen(true)
    }, [telegram.state])

    return (
        <div className="flex h-full min-h-0">
            <aside className={`${isIndex ? 'flex' : 'hidden split:flex'} w-full shrink-0 flex-col bg-[var(--app-bg)] pt-[env(safe-area-inset-top)]`} style={{ '--sidebar-w': `${sidebar.width}px` } as React.CSSProperties}>
                <ChatList conversations={conversations.data ?? []} selectedId={selectedId} onManage={() => setManageOpen(true)} />
                <PrimarySectionNav />
            </aside>
            <div className="sidebar-resize-handle hidden shrink-0 split:block" data-dragging={sidebar.isDragging || undefined} onPointerDown={sidebar.onPointerDown} />
            <main className={`${isIndex ? 'hidden split:flex' : 'flex'} min-w-0 flex-1 flex-col bg-[var(--app-bg)]`}><Outlet /></main>
            {manageOpen ? <ConnectionDialog connection={telegram} onClose={() => setManageOpen(false)} /> : null}
        </div>
    )
}

export function ChatsIndexPage() {
    const { t } = useTranslation()
    return <div className="m-auto hidden max-w-sm text-center text-sm text-[var(--app-hint)] split:block">{t('chats.pickConversation')}</div>
}

export function ChatConversationPage() {
    const { conversationId } = useParams({ from: '/chats/$conversationId' })
    const { api } = useAppContext()
    const { t } = useTranslation()
    const navigate = useNavigate()
    const queryClient = useQueryClient()
    const [text, setText] = useState('')
    const viewportRef = useRef<HTMLDivElement>(null)
    const messageContentRef = useRef<HTMLDivElement>(null)
    const fileInputRef = useRef<HTMLInputElement>(null)
    const composerRef = useRef<HTMLTextAreaElement>(null)
    const stickToBottomRef = useRef(true)
    const handleComposerFocus = useChatKeyboardTail({ viewportRef, composerRef, stickToBottomRef })
    const conversations = useQuery({
        queryKey: queryKeys.externalConversations,
        queryFn: async () => (await api!.getExternalConversations()).conversations,
        enabled: Boolean(api)
    })
    const conversation = conversations.data?.find((item) => item.id === conversationId)
    const messages = useExternalMessages(api, conversationId)
    const participantAvatars = useMemo(() => new Map(
        (messages.data?.participants ?? []).map((participant) => [participant.id, participant.avatarDataUrl])
    ), [messages.data?.participants])
    const send = useMutation({
        mutationFn: async (input: { text: string; clientId: string }) => {
            await api!.sendExternalMessage(conversationId, input.text, input.clientId)
        },
        onMutate: async (input) => {
            stickToBottomRef.current = true
            setText('')
            await queryClient.cancelQueries({ queryKey: queryKeys.externalMessages(conversationId) })
            const optimistic = createOptimisticExternalMessage({
                conversationId,
                clientId: input.clientId,
                text: input.text,
                ...getOptimisticExternalSender(
                    queryClient.getQueryData<ExternalMessagesResponse>(queryKeys.externalMessages(conversationId))
                )
            })
            queryClient.setQueryData<ExternalMessagesResponse>(
                queryKeys.externalMessages(conversationId),
                (current) => appendOptimisticExternalMessage(current, optimistic)
            )
            return { optimisticId: optimistic.id }
        },
        onSuccess: async () => {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: queryKeys.externalMessages(conversationId) }),
                queryClient.invalidateQueries({ queryKey: queryKeys.externalConversations })
            ])
        },
        onError: (_error, input, context) => {
            if (context?.optimisticId) {
                queryClient.setQueryData<ExternalMessagesResponse>(
                    queryKeys.externalMessages(conversationId),
                    (current) => removeOptimisticExternalMessage(current, context.optimisticId)
                )
            }
            setText((current) => current ? `${input.text}\n${current}` : input.text)
        }
    })
    const sendMedia = useMutation({
        mutationFn: async (file: File) => {
            if (file.size > 50 * 1024 * 1024) throw new Error('Media file must be 50 MB or smaller')
            await api!.sendExternalMedia(conversationId, file, text, crypto.randomUUID())
        },
        onMutate: () => {
            stickToBottomRef.current = true
        },
        onSuccess: async () => {
            setText('')
            if (fileInputRef.current) fileInputRef.current.value = ''
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: queryKeys.externalMessages(conversationId) }),
                queryClient.invalidateQueries({ queryKey: queryKeys.externalConversations })
            ])
        }
    })
    useLayoutEffect(() => {
        stickToBottomRef.current = true
        const viewport = viewportRef.current
        if (!viewport) return
        const frame = requestAnimationFrame(() => {
            viewport.scrollTop = viewport.scrollHeight
        })
        return () => cancelAnimationFrame(frame)
    }, [conversationId])

    useEffect(() => {
        const frame = requestAnimationFrame(() => composerRef.current?.focus())
        return () => cancelAnimationFrame(frame)
    }, [conversationId])

    useLayoutEffect(() => {
        if (!stickToBottomRef.current) return
        const viewport = viewportRef.current
        if (!viewport) return
        const frame = requestAnimationFrame(() => {
            viewport.scrollTop = viewport.scrollHeight
        })
        return () => cancelAnimationFrame(frame)
    }, [messages.data])

    useEffect(() => {
        const content = messageContentRef.current
        if (!content || typeof ResizeObserver === 'undefined') return
        const observer = new ResizeObserver(() => {
            const viewport = viewportRef.current
            if (viewport && stickToBottomRef.current) viewport.scrollTop = viewport.scrollHeight
        })
        observer.observe(content)
        return () => observer.disconnect()
    }, [conversationId])

    if (!conversation && conversations.isLoading) {
        return <div className="m-auto text-sm text-[var(--app-hint)]">{t('loading')}</div>
    }
    if (!conversation) {
        return <div className="m-auto text-sm text-[var(--app-hint)]">{t('chats.notFound')}</div>
    }
    const messageItems = messages.data?.messages ?? []

    return (
        <div className="flex h-full min-h-0 flex-col pt-[env(safe-area-inset-top)]">
            <header className="flex h-14 shrink-0 items-center gap-2 border-b border-[var(--app-border)] px-3">
                <button type="button" onClick={() => navigate({ to: '/chats' })} className="rounded-full p-2 text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)] split:hidden"><BackIcon /></button>
                <ConversationAvatar conversation={conversation} />
                <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{conversation.title}</div>
                    <div className="text-[10px] uppercase tracking-wide text-[var(--app-hint)]">Telegram</div>
                </div>
            </header>
            <div
                ref={viewportRef}
                onScroll={(event) => {
                    const viewport = event.currentTarget
                    stickToBottomRef.current = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 80
                }}
                className="min-h-0 flex-1 overflow-y-auto bg-[var(--app-chat-bg,var(--app-bg))] px-3 py-5"
            >
                <div ref={messageContentRef} className="mx-auto flex w-full max-w-content flex-col gap-2">
                    {messageItems.map((item, index) => {
                        const incoming = item.direction === 'incoming'
                        const optimistic = isOptimisticExternalMessage(item)
                        const hasMedia = Boolean(item.media?.length)
                        const continuesPrevious = areExternalMessagesGrouped(messageItems[index - 1], item)
                        const continuesNext = areExternalMessagesGrouped(item, messageItems[index + 1])
                        const avatarSrc = item.senderAvatarDataUrl
                            ?? (item.senderId ? participantAvatars.get(item.senderId) : null)
                            ?? (incoming && conversation.kind === 'direct' ? conversation.avatarDataUrl : null)
                        const groupedCornerClassName = incoming
                            ? cn(continuesPrevious && 'rounded-tl-md', continuesNext && 'rounded-bl-md')
                            : cn(continuesPrevious && 'rounded-tr-md', continuesNext && 'rounded-br-md')
                        const bubbleClassName = incoming
                            ? cn('happy-chat-text w-fit max-w-full rounded-2xl bg-[var(--app-secondary-bg)] px-4 py-2.5 text-[var(--app-fg)]', groupedCornerClassName)
                            : cn(getUserBubbleClassName(), 'max-w-full', groupedCornerClassName)
                        const caption = item.text ? (
                            <div className="flex items-end gap-2">
                                <div className="min-w-0 flex-1">
                                    <ExternalMessageText text={item.text} />
                                </div>
                                <time
                                    dateTime={new Date(item.createdAt).toISOString()}
                                    title={new Date(item.createdAt).toLocaleString()}
                                    className="shrink-0 pb-0.5 text-[9px] leading-none opacity-60 tabular-nums"
                                >
                                    {formatTime(item.createdAt)}
                                    {optimistic ? <span aria-label="Sending" className="ml-1 inline-block">◷</span> : null}
                                </time>
                            </div>
                        ) : null
                        return (
                            <div key={item.id} className={cn('flex w-full items-end gap-2', continuesPrevious && '-mt-1', incoming ? 'justify-start' : 'justify-end')}>
                                {incoming ? (
                                    continuesNext
                                        ? <div aria-hidden="true" className="h-8 w-8 shrink-0" />
                                        : <ChatParticipantAvatar src={avatarSrc} name={item.senderName ?? conversation.title} />
                                ) : null}
                                <div className={cn('flex min-w-0 max-w-[calc(92%-2.5rem)] flex-col', incoming ? 'items-start' : 'items-end')}>
                                    {incoming && !continuesPrevious && item.senderName && conversation.kind !== 'direct' ? <div className="mb-1 px-2 text-[10px] text-[var(--app-hint)]">{item.senderName}</div> : null}
                                    {hasMedia && caption ? (
                                        <div className={cn(bubbleClassName, 'overflow-hidden p-1')}>
                                            <div className="flex max-w-full flex-col gap-1.5">
                                                {item.media!.map((media, index) => <MediaAttachment key={`${item.id}:${index}`} media={media} galleryId={`telegram-media-${conversationId}`} conversationId={conversationId} providerMessageId={item.providerMessageId} mediaIndex={index} />)}
                                            </div>
                                            <div className="px-3 pb-1.5 pt-2">{caption}</div>
                                        </div>
                                    ) : (
                                        <>
                                            {hasMedia ? <div className="mb-1 flex max-w-full flex-col gap-1.5">{item.media!.map((media, index) => <MediaAttachment key={`${item.id}:${index}`} media={media} galleryId={`telegram-media-${conversationId}`} conversationId={conversationId} providerMessageId={item.providerMessageId} mediaIndex={index} />)}</div> : null}
                                            {caption ? <div className={bubbleClassName}>{caption}</div> : null}
                                        </>
                                    )}
                                    {!item.text ? <div className="mt-0.5 px-2 text-[9px] text-[var(--app-hint)]">{formatTime(item.createdAt)}</div> : null}
                                </div>
                                {!incoming ? (
                                    continuesNext
                                        ? <div aria-hidden="true" className="h-8 w-8 shrink-0" />
                                        : <ChatParticipantAvatar src={avatarSrc} name={item.senderName} currentUser />
                                ) : null}
                            </div>
                        )
                    })}
                </div>
            </div>
            <form className="shrink-0 border-t border-[var(--app-border)] bg-[var(--app-bg)] p-2 pb-[max(.5rem,env(safe-area-inset-bottom))]" onSubmit={(event) => {
                event.preventDefault()
                const value = text.trim()
                if (value && !send.isPending) {
                    composerRef.current?.focus({ preventScroll: true })
                    send.mutate({ text: value, clientId: crypto.randomUUID() })
                }
            }}>
                <div className="mx-auto flex max-w-content items-end gap-2 rounded-2xl border border-[var(--app-border)] bg-[var(--app-secondary-bg)] p-1.5 pl-3 focus-within:border-[var(--app-link)]">
                    <input
                        ref={fileInputRef}
                        type="file"
                        className="hidden"
                        onChange={(event) => {
                            const file = event.target.files?.[0]
                            if (file) sendMedia.mutate(file)
                        }}
                    />
                    <button type="button" disabled={sendMedia.isPending} onClick={() => fileInputRef.current?.click()} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[var(--app-hint)] hover:bg-[var(--app-bg)] hover:text-[var(--app-fg)] disabled:opacity-35" title="Attach media"><AttachmentIcon /></button>
                    <textarea
                        ref={composerRef}
                        onFocus={handleComposerFocus}
                        value={text}
                        onChange={(event) => setText(event.target.value)}
                        onPaste={(event) => {
                            const image = imageFileFromClipboard(event.clipboardData.items)
                            if (!image) return
                            event.preventDefault()
                            sendMedia.mutate(image)
                        }}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter' && !event.shiftKey) {
                                event.preventDefault()
                                event.currentTarget.form?.requestSubmit()
                            }
                        }}
                        rows={1}
                        placeholder={t('chats.messagePlaceholder')}
                        className="max-h-32 min-h-9 flex-1 resize-none bg-transparent py-2 text-sm outline-none placeholder:text-[var(--app-hint)]"
                    />
                    <button type="submit" onPointerDown={(event) => event.preventDefault()} disabled={!text.trim() || send.isPending || sendMedia.isPending} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--app-button)] text-[var(--app-button-text)] disabled:opacity-35" title={t('chats.send')}><SendIcon /></button>
                </div>
                {send.error ? <div className="mx-auto mt-1 max-w-content px-2 text-xs text-red-600">{send.error.message}</div> : null}
                {sendMedia.error ? <div className="mx-auto mt-1 max-w-content px-2 text-xs text-red-600">{sendMedia.error.message}</div> : null}
                {sendMedia.isPending ? <div className="mx-auto mt-1 max-w-content px-2 text-xs text-[var(--app-hint)]">Uploading media…</div> : null}
            </form>
        </div>
    )
}
