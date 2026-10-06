import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Outlet, useLocation, useNavigate, useParams } from '@tanstack/react-router'
import type { ExternalConversation, ExternalMedia, ExternalMessage, ExternalMessagesResponse, ExternalParticipant, ExternalReaction, MessengerConnection, SubmitMessengerAuthRequest } from '@hapi/protocol/messengers'
import { ExternalMessageText } from '@/components/ExternalMessageText'
import { ExternalDeliveryStatus } from '@/components/ExternalDeliveryStatus'
import { ImagePreview } from '@/components/ImagePreview'
import { KlipyGifPicker } from '@/components/KlipyGifPicker'
import { useKlipyEnabled } from '@/hooks/queries/useKlipy'
import { PrimarySectionNav } from '@/components/PrimarySectionNav'
import { RoundVideoPlayer } from '@/components/RoundVideoPlayer'
import { ChatParticipantAvatar } from '@/components/ChatParticipantAvatar'
import { getUserBubbleClassName } from '@/components/AssistantChat/messages/user-bubble'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { useSidebarResize } from '@/hooks/useSidebarResize'
import { useChatKeyboardTail } from '@/hooks/useChatKeyboardTail'
import { useChatsComposerAutoFocus } from '@/hooks/useChatsComposerAutoFocus'
import { useChatsPendingMedia } from '@/hooks/useChatsPendingMedia'
import { useExternalMessagePrefetch } from '@/hooks/useExternalMessagePrefetch'
import { useExternalMessages } from '@/hooks/queries/useExternalMessages'
import { useExternalMessageOutbox } from '@/hooks/mutations/useExternalMessageOutbox'
import { MessageStatusIndicator } from '@/components/AssistantChat/messages/MessageStatusIndicator'
import { useAppContext } from '@/lib/app-context'
import { upsertMessengerConnection } from '@/lib/messengerConnections'
import { queryKeys } from '@/lib/query-keys'
import { useTranslation } from '@/lib/use-translation'
import { cn } from '@/lib/utils'
import { formatMessageTimestamp } from '@/chat/presentation'
import { areExternalMessagesGrouped } from '@/chat/messageGrouping'
import { shouldAutoLoadExternalMedia } from '@/chat/externalMedia'
import { isOptimisticExternalMessage } from '@/chat/optimisticExternalMessages'

function TelegramMark(props: { className?: string }) {
    return (
        <svg viewBox="0 0 24 24" className={props.className} fill="currentColor" aria-hidden="true">
            <path d="M21.7 3.5 18.6 20c-.2 1.2-.9 1.5-1.9.9l-4.7-3.5-2.3 2.2c-.3.3-.5.5-1 .5l.3-4.8 8.8-8c.4-.3-.1-.5-.6-.2L6.3 14 1.6 12.5c-1-.3-1-1 .2-1.5L20.2 3.9c.9-.3 1.7.2 1.5-.4Z" />
        </svg>
    )
}

function YandexMark(props: { className?: string }) {
    // Brand glyph approximated with the Cyrillic letter; Yandex renders no official mark here.
    return (
        <svg viewBox="0 0 24 24" className={props.className} aria-hidden="true">
            <text x="12" y="18.5" textAnchor="middle" fontSize="19" fontWeight="700" fill="currentColor">Я</text>
        </svg>
    )
}

type ChatsProvider = 'telegram' | 'yandex'

const chatsProviders: ChatsProvider[] = ['telegram', 'yandex']

const PROVIDER_LABELS: Record<ChatsProvider, string> = { telegram: 'Telegram', yandex: 'Yandex' }

const providerAvatarAccents: Record<ChatsProvider, string> = {
    telegram: 'bg-[#2AABEE]/15 text-[#229ED9]',
    yandex: 'bg-[#FC3F1D]/15 text-[#FC3F1D]'
}

function ProviderMark({ provider, className }: { provider: ChatsProvider; className?: string }) {
    return provider === 'yandex'
        ? <YandexMark className={className} />
        : <TelegramMark className={className} />
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

function GifIcon() {
    return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5" aria-hidden="true"><rect x="3" y="6" width="18" height="12" rx="2" /><text x="12" y="15" fontFamily="ui-sans-serif, system-ui, sans-serif" fontSize="7" fontWeight="700" fill="currentColor" stroke="none" textAnchor="middle">GIF</text></svg>
}

function ReplyIcon() {
    return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5" aria-hidden="true"><path d="M9 14 4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 6 6v4" /></svg>
}

function ReactionMoreIcon({ expanded }: { expanded: boolean }) {
    return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={cn('h-5 w-5 transition-transform', expanded && 'rotate-180')} aria-hidden="true"><path d="m7 10 5 5 5-5" /></svg>
}

const defaultFrequentReactions = ['👍', '❤️', '🔥', '🥰', '👏', '😁'] as const
const allReactions = [
    '👍', '👎', '❤️', '🔥', '🥰', '👏', '😁',
    '🤔', '🤯', '😢', '🎉', '🤩', '🤣', '🙏',
    '👌', '💯', '😍', '🤝', '😎', '🤓', '🫡',
    '😡', '🤡', '🥱', '🥴', '🤮', '💩', '😭',
    '😈', '😴', '👀', '👻', '🙈', '🙉', '🙊',
    '💔', '❤️‍🔥', '⚡', '🏆', '🍾', '💋', '🗿'
] as const
const reactionUsageStorageKey = 'hapi.telegram.reaction-usage.v1'
const emojiFontFamily = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif'

function displayReactionEmoji(emoji: string | null): string {
    return emoji === '❤' ? '❤️' : (emoji ?? '✦')
}

function loadReactionUsage(): Record<string, number> {
    if (typeof window === 'undefined') return {}
    try {
        const value = JSON.parse(window.localStorage.getItem(reactionUsageStorageKey) ?? '{}') as unknown
        if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
        return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, number] =>
            typeof entry[1] === 'number' && Number.isFinite(entry[1]) && entry[1] > 0
        ))
    } catch {
        return {}
    }
}

function updatedReactions(
    current: ExternalReaction[],
    reaction: string,
    emoji: string | null
): { selected: string[]; optimistic: ExternalReaction[] } {
    const existing = current.find((item) => item.reaction === reaction)
    const activating = !existing?.chosen
    const selected = current.filter((item) => item.chosen && item.reaction !== reaction).map((item) => item.reaction)
    if (activating) selected.push(reaction)
    const optimistic = current.flatMap((item) => {
        if (item.reaction !== reaction) return [item]
        const count = item.count + (activating ? 1 : -1)
        return count > 0 ? [{ ...item, count, chosen: activating }] : []
    })
    if (!existing && activating) optimistic.push({ reaction, emoji, count: 1, chosen: true })
    return { selected: selected.slice(-3), optimistic }
}

function formatTime(value: number | null): string {
    if (!value) return ''
    return formatMessageTimestamp(new Date(value))
}

function ConversationAvatar({ conversation }: { conversation: ExternalConversation }) {
    const accent = providerAvatarAccents[conversation.provider as ChatsProvider] ?? providerAvatarAccents.telegram
    const initials = conversation.title.trim().slice(0, 2).toUpperCase() || '··'
    return (
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full text-xs font-semibold ${accent}`}>
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

const senderNameColors = ['#6AB3F3', '#9B8AFB', '#E879B1', '#F08C6A', '#5CC8A1', '#D4A84F'] as const

function senderNameColor(senderId: string | null): string {
    let hash = 0
    for (const character of senderId ?? '') hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0
    return senderNameColors[Math.abs(hash) % senderNameColors.length]
}

function MediaAttachment(props: {
    media: ExternalMedia
    galleryId: string
    conversationId: string
    providerMessageId: string
    mediaIndex: number
    overlay?: ReactNode
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
        const isSticker = media.kind === 'sticker'
        return (
            <ImagePreview
                src={fullUrl}
                fileName={media.fileName ?? label}
                label={label}
                galleryId={props.galleryId}
                buttonClassName={cn(
                    'group relative flex cursor-zoom-in items-center justify-center overflow-hidden rounded-xl bg-black/10',
                    isSticker ? 'w-[min(64vw,15rem)]' : 'w-[min(82vw,30rem)]'
                )}
                imageClassName={cn(
                    'w-full object-contain transition-transform group-hover:scale-[1.01]',
                    isSticker ? 'max-h-[15rem]' : 'max-h-[32rem]'
                )}
                caption={props.overlay}
            />
        )
    }
    if (fullUrl && media.kind === 'video') {
        if (media.isRound) {
            return <div className="relative w-fit"><RoundVideoPlayer src={fullUrl} label={media.fileName ?? label} />{props.overlay}</div>
        }
        return <div className="relative w-fit"><video src={fullUrl} controls={!media.isAnimated} autoPlay={media.isAnimated} loop={media.isAnimated} muted={media.isAnimated} playsInline preload="metadata" className="max-h-[32rem] max-w-[min(82vw,30rem)] rounded-xl bg-black object-contain" />{props.overlay}</div>
    }
    if (fullUrl && (media.kind === 'audio' || media.kind === 'voice')) {
        return <audio src={fullUrl} controls preload="metadata" className="max-w-[82vw]" />
    }
    if (fullUrl && media.kind === 'file') {
        return <a href={fullUrl} download={media.fileName ?? 'attachment'} className="rounded-xl border border-[var(--app-border)] bg-[var(--app-subtle-bg)] px-4 py-3 text-sm text-[var(--app-link)]">Download {media.fileName ?? 'file'}</a>
    }

    if (hasVisualPreview) {
        const isSticker = media.kind === 'sticker'
        return (
            <button ref={(node) => { previewRef.current = node }} type="button" onClick={() => void loadOriginal()} disabled={loading} className={cn('group relative flex cursor-pointer items-center justify-center overflow-hidden bg-black/10 disabled:cursor-wait', media.isRound ? 'h-[min(14rem,72vw)] w-[min(14rem,72vw)] rounded-full' : isSticker ? 'w-[min(64vw,15rem)] rounded-xl' : 'w-[min(82vw,24rem)] rounded-xl')}>
                <img src={media.thumbnailDataUrl!} alt={label} className={cn('w-full transition-opacity', media.isRound ? 'h-full object-cover' : isSticker ? 'max-h-[15rem] object-contain' : 'max-h-80 min-h-36 object-contain', loading && 'opacity-70')} />
                {loading || error || media.kind === 'video' ? <span className="absolute inset-0 grid place-items-center bg-black/20 text-center text-sm font-medium text-white opacity-100 drop-shadow transition-opacity sm:opacity-0 sm:group-hover:opacity-100 group-disabled:opacity-100">{loading ? 'Loading original…' : error ? 'Tap to retry' : '▶ Play video'}</span> : null}
                {props.overlay}
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
    const fallbackClassName = 'relative flex min-w-48 items-center gap-3 rounded-xl border border-[var(--app-border)] bg-[var(--app-subtle-bg)] px-3 py-2.5 text-left'
    if (downloadable) {
        return <button ref={(node) => { previewRef.current = node }} type="button" onClick={() => void loadOriginal()} className={fallbackClassName}>{fallbackContent}{props.overlay}</button>
    }
    return <div ref={(node) => { previewRef.current = node }} className={fallbackClassName}>{fallbackContent}</div>
}

function LocalAliasInput(props: {
    value: string | null | undefined
    placeholder: string
    onSave: (value: string | null) => Promise<void>
}) {
    const [value, setValue] = useState(props.value ?? '')
    const [saving, setSaving] = useState(false)
    const [failed, setFailed] = useState(false)
    useEffect(() => setValue(props.value ?? ''), [props.value])
    const save = async () => {
        const next = value.trim() || null
        if (next === (props.value ?? null)) return
        setSaving(true)
        setFailed(false)
        try {
            await props.onSave(next)
        } catch {
            setFailed(true)
        } finally {
            setSaving(false)
        }
    }
    return (
        <input
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onBlur={() => void save()}
            onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur()
                if (event.key === 'Escape') {
                    setValue(props.value ?? '')
                    event.currentTarget.blur()
                }
            }}
            aria-label={props.placeholder}
            placeholder={props.placeholder}
            disabled={saving}
            className={cn(
                'min-w-0 w-full rounded-lg border bg-[var(--app-secondary-bg)] px-2.5 py-1.5 text-xs outline-none placeholder:text-[var(--app-hint)] focus:border-[var(--app-link)] disabled:opacity-60',
                failed ? 'border-red-500' : 'border-[var(--app-border)]'
            )}
        />
    )
}

function ParticipantAliases(props: { conversation: ExternalConversation }) {
    const { api } = useAppContext()
    const { t } = useTranslation()
    const queryClient = useQueryClient()
    const [open, setOpen] = useState(false)
    const participants = useQuery({
        queryKey: queryKeys.externalParticipants(props.conversation.id),
        queryFn: async () => (await api!.getExternalParticipants(props.conversation.id)).participants,
        enabled: Boolean(api && open)
    })
    const save = async (participant: ExternalParticipant, name: string | null) => {
        await api!.updateExternalParticipantAlias(props.conversation.id, participant.id, name)
        await Promise.all([
            queryClient.invalidateQueries({ queryKey: queryKeys.externalParticipants(props.conversation.id) }),
            queryClient.invalidateQueries({ queryKey: queryKeys.externalMessages(props.conversation.id) })
        ])
    }
    return (
        <div className="mt-2 border-t border-[var(--app-border)] pt-1.5">
            <button
                type="button"
                onClick={() => setOpen((current) => !current)}
                aria-expanded={open}
                className="flex w-full items-center gap-2 rounded-lg px-1 py-1.5 text-left text-xs font-medium hover:bg-[var(--app-secondary-bg)]"
            >
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--app-secondary-bg)] text-[var(--app-link)]">
                    <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
                        <circle cx="7" cy="7" r="2.5" />
                        <circle cx="13.5" cy="8" r="2" />
                        <path d="M2.5 16c.4-3 1.9-4.5 4.5-4.5s4.1 1.5 4.5 4.5M11.5 12c2.8-.4 4.6.9 5 3.5" />
                    </svg>
                </span>
                <span className="flex-1">{t('chats.names.people')}</span>
                <svg viewBox="0 0 20 20" className={cn('h-4 w-4 text-[var(--app-hint)] transition-transform', open && 'rotate-180')} fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                    <path d="m5 7.5 5 5 5-5" />
                </svg>
            </button>
            {open ? <div className="mt-1 overflow-hidden rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)]">
                {participants.isLoading ? <div className="py-2 text-xs text-[var(--app-hint)]">{t('chats.names.loadingPeople')}</div> : null}
                {(participants.data ?? []).map((participant) => (
                    <div key={participant.id} className="flex items-center gap-2 border-b border-[var(--app-border)] px-2 py-2 last:border-b-0">
                        <ChatParticipantAvatar src={participant.avatarDataUrl} name={participant.name} />
                        <div className="min-w-0 flex-1">
                            <div className="mb-1 truncate text-xs font-medium">{participant.sourceName ?? participant.name ?? participant.id}</div>
                            <LocalAliasInput
                                value={participant.customName}
                                placeholder={t('chats.names.personPlaceholder')}
                                onSave={(name) => save(participant, name)}
                            />
                        </div>
                    </div>
                ))}
            </div> : null}
        </div>
    )
}

function ConversationAliases(props: { conversations: ExternalConversation[] }) {
    const { api } = useAppContext()
    const { t } = useTranslation()
    const queryClient = useQueryClient()
    const save = async (conversation: ExternalConversation, name: string | null) => {
        await api!.updateExternalConversationAlias(conversation.id, name)
        await Promise.all([
            queryClient.invalidateQueries({ queryKey: queryKeys.messengerCandidates(conversation.provider) }),
            queryClient.invalidateQueries({ queryKey: queryKeys.externalConversations })
        ])
    }
    if (props.conversations.length === 0) return null
    return (
        <section className="mt-5 border-t border-[var(--app-border)] pt-4">
            <h3 className="text-sm font-semibold">{t('chats.names.title')}</h3>
            <p className="mt-1 text-xs leading-relaxed text-[var(--app-hint)]">{t('chats.names.hint')}</p>
            <div className="mt-3 overflow-hidden rounded-xl border border-[var(--app-border)]">
                {props.conversations.map((conversation) => (
                    <div key={conversation.id} className="border-b border-[var(--app-border)] bg-[var(--app-subtle-bg)] p-2.5 last:border-b-0">
                        <div className="flex items-center gap-2">
                            <ConversationAvatar conversation={conversation} />
                            <div className="min-w-0 flex-1">
                                <div className="mb-1 truncate text-xs font-medium">{conversation.sourceTitle ?? conversation.title}</div>
                                <LocalAliasInput
                                    value={conversation.customTitle}
                                    placeholder={t('chats.names.chatPlaceholder')}
                                    onSave={(name) => save(conversation, name)}
                                />
                            </div>
                        </div>
                        {conversation.kind === 'group' ? <ParticipantAliases conversation={conversation} /> : null}
                    </div>
                ))}
            </div>
        </section>
    )
}

function ProviderSection(props: { provider: ChatsProvider; connection: MessengerConnection }) {
    const { api } = useAppContext()
    const { t } = useTranslation()
    const queryClient = useQueryClient()
    const provider = props.provider
    const [apiId, setApiId] = useState('')
    const [apiHash, setApiHash] = useState('')
    const [cookies, setCookies] = useState('')
    const [authValue, setAuthValue] = useState('')
    const [selected, setSelected] = useState<Set<string>>(new Set())
    const selectionInitialized = useRef(false)
    const [candidateSearch, setCandidateSearch] = useState('')
    const [error, setError] = useState<string | null>(null)
    const ready = props.connection.state === 'ready'
    const cacheConnection = (connection: MessengerConnection) => {
        queryClient.setQueryData<MessengerConnection[]>(
            queryKeys.messengerConnections,
            (current) => upsertMessengerConnection(current, connection)
        )
    }
    // Candidates are not auto-fetched on mount: opening this dialog should not
    // slam the messenger backend. The first time `fetchNow` flips true we
    // either reuse whatever is already in cache (refreshing in the background
    // once 60 s have passed since the previous explicit refresh) or pull a
    // fresh list with `?refresh=true`.
    const [candidatesLoaded, setCandidatesLoaded] = useState(false)
    const fetchCandidatesNow = () => setCandidatesLoaded(true)
    const candidates = useQuery({
        queryKey: queryKeys.messengerCandidates(provider),
        queryFn: async () => (await api!.getMessengerCandidates(provider, { refresh: true })).conversations,
        enabled: Boolean(api && ready && candidatesLoaded)
    })
    const visibleCandidates = useMemo(() => {
        const query = candidateSearch.trim().toLocaleLowerCase()
        if (!query) return candidates.data ?? []
        return (candidates.data ?? []).filter((conversation) => (
            conversation.title.toLocaleLowerCase().includes(query)
            || conversation.sourceTitle?.toLocaleLowerCase().includes(query)
        ))
    }, [candidateSearch, candidates.data])
    const selectedCandidates = useMemo(
        () => (candidates.data ?? []).filter((conversation) => selected.has(conversation.remoteId)),
        [candidates.data, selected]
    )

    useEffect(() => {
        if (candidates.data && !selectionInitialized.current) {
            selectionInitialized.current = true
            setSelected(new Set(candidates.data.filter((item) => item.selected).map((item) => item.remoteId)))
        }
    }, [candidates.data])

    const configure = useMutation({
        mutationFn: async () => provider === 'telegram'
            ? api!.configureTelegram({ apiId: Number(apiId), apiHash })
            : api!.configureYandex({ cookies }),
        onSuccess: ({ connection }) => {
            cacheConnection(connection)
            setError(null)
        },
        onError: (cause) => setError(cause instanceof Error ? cause.message : t('dialog.error.default'))
    })
    const submitAuth = useMutation({
        mutationFn: async (input: SubmitMessengerAuthRequest) => api!.submitMessengerAuth(provider, input),
        onSuccess: ({ connection }) => {
            cacheConnection(connection)
            setAuthValue('')
            setError(null)
        },
        onError: (cause) => setError(cause instanceof Error ? cause.message : t('dialog.error.default'))
    })
    const saveSelection = useMutation({
        mutationFn: async () => api!.selectMessengerConversations(provider, { remoteIds: [...selected] }),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: queryKeys.externalConversations })
        },
        onError: (cause) => setError(cause instanceof Error ? cause.message : t('dialog.error.default'))
    })
    const refreshCandidates = useMutation({
        mutationFn: async () => (await api!.getMessengerCandidates(provider, { refresh: true })).conversations,
        onSuccess: (conversations) => {
            queryClient.setQueryData(queryKeys.messengerCandidates(provider), conversations)
        },
        onError: (cause) => setError(cause instanceof Error ? cause.message : t('dialog.error.default'))
    })

    const authKind = props.connection.state.replace('awaiting_', '') as SubmitMessengerAuthRequest['kind']
    const authLabel = authKind === 'phone'
        ? t('chats.telegram.phone')
        : authKind === 'code'
            ? t('chats.telegram.code')
            : t('chats.telegram.password')
    const connectDisabled = provider === 'telegram' ? (!apiId || !apiHash) : cookies.trim().length === 0
    const connectLabel = provider === 'telegram' ? t('chats.connectTelegram') : t('chats.connectYandex')

    return (
        <section>
            <div className="mb-3 flex items-center gap-3">
                <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white ${provider === 'yandex' ? 'bg-[#FC3F1D]' : 'bg-[#2AABEE]'}`}>
                    <ProviderMark provider={provider} className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold">{PROVIDER_LABELS[provider]}</div>
                    <div className="truncate text-xs text-[var(--app-hint)]">{props.connection.accountLabel ?? t(`chats.connection.${props.connection.state}`)}</div>
                </div>
            </div>
            {ready ? (
                <>
                    <p className="mb-3 text-sm text-[var(--app-hint)]">{t('chats.select.hint')}</p>
                    {candidates.error ? <div className="mb-3 text-sm text-red-600">{candidates.error.message}</div> : null}
                    {!candidates.data && !candidates.isLoading ? (
                        <div className="mb-3 flex flex-col items-start gap-2 rounded-xl border border-dashed border-[var(--app-border)] bg-[var(--app-subtle-bg)] px-3 py-4">
                            <div className="text-sm text-[var(--app-hint)]">{t('chats.loadChats.hint')}</div>
                            <button
                                type="button"
                                disabled={refreshCandidates.isPending}
                                onClick={() => {
                                    fetchCandidatesNow()
                                    refreshCandidates.mutate()
                                }}
                                className="rounded-xl bg-[var(--app-button)] px-4 py-2 text-sm font-medium text-[var(--app-button-text)] disabled:opacity-50"
                            >
                                {refreshCandidates.isPending ? t('chats.refreshing') : t('chats.loadChats.cta')}
                            </button>
                        </div>
                    ) : null}
                    {candidates.isLoading ? <div className="py-8 text-center text-sm text-[var(--app-hint)]">{t('loading')}</div> : null}
                    {candidates.data ? (
                        <div className="mb-3 flex gap-2">
                            <input
                                value={candidateSearch}
                                onChange={(event) => setCandidateSearch(event.target.value)}
                                placeholder="Search cached chats"
                                className="min-w-0 flex-1 rounded-xl border border-[var(--app-border)] bg-[var(--app-secondary-bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--app-link)]"
                            />
                            <button
                                type="button"
                                disabled={refreshCandidates.isPending}
                                onClick={() => refreshCandidates.mutate()}
                                className="shrink-0 rounded-xl border border-[var(--app-border)] px-3 text-xs font-medium text-[var(--app-link)] disabled:opacity-50"
                            >
                                {refreshCandidates.isPending ? t('chats.refreshing') : t('chats.refresh')}
                            </button>
                        </div>
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
                    <ConversationAliases conversations={selectedCandidates} />
                </>
            ) : props.connection.state.startsWith('awaiting_') ? (
                <form onSubmit={(event) => {
                    event.preventDefault()
                    submitAuth.mutate({ kind: authKind, value: authValue })
                }}>
                    <label className="mb-1 block text-sm font-medium">{authLabel}</label>
                    <input
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
                <div className="py-10 text-center text-sm text-[var(--app-hint)]">{t('chats.connecting')}</div>
            ) : provider === 'telegram' ? (
                <form onSubmit={(event) => {
                    event.preventDefault()
                    configure.mutate()
                }}>
                    <p className="mb-4 text-sm text-[var(--app-hint)]">{t('chats.telegram.credentialsHint')}</p>
                    <label className="mb-1 block text-sm font-medium">API ID</label>
                    <input value={apiId} onChange={(event) => setApiId(event.target.value.replace(/\D/g, ''))} inputMode="numeric" className="mb-3 w-full rounded-xl border border-[var(--app-border)] bg-[var(--app-secondary-bg)] px-3 py-2.5 outline-none focus:border-[var(--app-link)]" />
                    <label className="mb-1 block text-sm font-medium">API Hash</label>
                    <input value={apiHash} onChange={(event) => setApiHash(event.target.value)} className="w-full rounded-xl border border-[var(--app-border)] bg-[var(--app-secondary-bg)] px-3 py-2.5 outline-none focus:border-[var(--app-link)]" />
                    <button type="submit" disabled={connectDisabled || configure.isPending} className="mt-3 w-full rounded-xl bg-[var(--app-button)] px-4 py-2.5 text-sm font-medium text-[var(--app-button-text)] disabled:opacity-50">
                        {configure.isPending ? t('chats.connecting') : connectLabel}
                    </button>
                </form>
            ) : (
                <form onSubmit={(event) => {
                    event.preventDefault()
                    configure.mutate()
                }}>
                    <p className="mb-4 text-sm text-[var(--app-hint)]">{t('chats.yandex.cookiesHint')}</p>
                    <label className="mb-1 block text-sm font-medium">{t('chats.yandex.cookiesLabel')}</label>
                    <textarea
                        value={cookies}
                        onChange={(event) => setCookies(event.target.value)}
                        rows={5}
                        placeholder={t('chats.yandex.cookiesPlaceholder')}
                        className="w-full resize-y rounded-xl border border-[var(--app-border)] bg-[var(--app-secondary-bg)] px-3 py-2.5 font-mono text-xs outline-none focus:border-[var(--app-link)]"
                    />
                    <button type="submit" disabled={connectDisabled || configure.isPending} className="mt-3 w-full rounded-xl bg-[var(--app-button)] px-4 py-2.5 text-sm font-medium text-[var(--app-button-text)] disabled:opacity-50">
                        {configure.isPending ? t('chats.connecting') : connectLabel}
                    </button>
                </form>
            )}
            {props.connection.detail ? <div className="mt-3 rounded-xl bg-[var(--app-subtle-bg)] p-3 text-xs text-[var(--app-hint)]">{props.connection.detail}</div> : null}
            {error ? <div className="mt-3 text-sm text-red-600">{error}</div> : null}
        </section>
    )
}

/** One dialog managing every messenger at once: the chat list itself stays shared. */
function ManageChatsDialog(props: {
    connections: MessengerConnection[] | undefined
    onClose: () => void
}) {
    const { t } = useTranslation()
    const byProvider = new Map((props.connections ?? []).map((connection) => [connection.provider, connection]))
    return (
        <Dialog open onOpenChange={(open) => { if (!open) props.onClose() }}>
            <DialogContent className="max-h-[88dvh] overflow-hidden border border-[var(--app-border)] bg-[var(--app-bg)] p-0">
                <DialogDescription className="sr-only">{t('chats.select.hint')}</DialogDescription>
                <div className="border-b border-[var(--app-border)] px-4 py-3 pr-14">
                    <DialogTitle className="font-semibold">{t('chats.title')}</DialogTitle>
                    <div className="truncate text-xs text-[var(--app-hint)]">{t('chats.manage')}</div>
                </div>
                <div className="max-h-[calc(88dvh-4rem)] space-y-6 overflow-y-auto p-4">
                    {chatsProviders.map((provider) => (
                        <ProviderSection
                            key={provider}
                            provider={provider}
                            connection={byProvider.get(provider) ?? {
                                provider, state: 'unconfigured', accountLabel: null, detail: null
                            } satisfies MessengerConnection}
                        />
                    ))}
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
                        <span className="mx-auto mb-3 flex items-center justify-center gap-2">
                            <TelegramMark className="h-8 w-8 text-[#229ED9]" />
                            <YandexMark className="h-8 w-8 text-[#FC3F1D]" />
                        </span>
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
                                {conversation.lastMessageDirection === 'outgoing' && conversation.lastMessageDeliveryStatus
                                    ? <ExternalDeliveryStatus status={conversation.lastMessageDeliveryStatus} className="self-center text-[#2AABEE]" />
                                    : null}
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
            const busy = query.state.data?.some((item) =>
                item.state === 'starting' || item.state.startsWith('awaiting_'))
            return busy ? 1500 : false
        }
    })
    const conversations = useQuery({
        queryKey: queryKeys.externalConversations,
        queryFn: async () => (await api!.getExternalConversations()).conversations,
        enabled: Boolean(api)
    })
    useExternalMessagePrefetch(api, conversations.data)

    useEffect(() => {
        if (connections.data?.some((item) => item.state.startsWith('awaiting_'))) setManageOpen(true)
    }, [connections.data])

    return (
        <div className="flex h-full min-h-0">
            <aside className={`${isIndex ? 'flex' : 'hidden split:flex'} w-full shrink-0 flex-col bg-[var(--app-bg)] pt-[env(safe-area-inset-top)]`} style={{ '--sidebar-w': `${sidebar.width}px` } as React.CSSProperties}>
                <ChatList
                    conversations={conversations.data ?? []}
                    selectedId={selectedId}
                    onManage={() => setManageOpen(true)}
                />
                <PrimarySectionNav />
            </aside>
            <div className="sidebar-resize-handle hidden shrink-0 split:block" data-dragging={sidebar.isDragging || undefined} onPointerDown={sidebar.onPointerDown} />
            <main className={`${isIndex ? 'hidden split:flex' : 'flex'} min-w-0 flex-1 flex-col bg-[var(--app-bg)]`}><Outlet /></main>
            {manageOpen ? <ManageChatsDialog connections={connections.data} onClose={() => setManageOpen(false)} /> : null}
        </div>
    )
}

export function ChatsIndexPage() {
    const { t } = useTranslation()
    return <div className="m-auto hidden max-w-sm text-center text-sm text-[var(--app-hint)] split:block">{t('chats.pickConversation')}</div>
}

// Conversation pane shared by the full chats view and the sessions layout:
// `backTo` decides where the mobile back arrow returns to.
export function ChatConversationPane(props: { conversationId: string; backTo: '/chats' | '/sessions' }) {
    const conversationId = props.conversationId
    const { api } = useAppContext()
    const { t } = useTranslation()
    const navigate = useNavigate()
    const connections = useQuery({
        queryKey: queryKeys.messengerConnections,
        queryFn: async () => (await api!.getMessengerConnections()).connections,
        enabled: Boolean(api)
    })
    const queryClient = useQueryClient()
    const [text, setText] = useState('')
    const [gifPickerOpen, setGifPickerOpen] = useState(false)
    const { pendingMedia, previewUrl, clearPendingMedia, handlePaste: handlePendingPaste } = useChatsPendingMedia()
    const [reactionPickerFor, setReactionPickerFor] = useState<string | null>(null)
    const [reactionPickerExpanded, setReactionPickerExpanded] = useState(false)
    const [replyTo, setReplyTo] = useState<ExternalMessage | null>(null)
    const [highlightedReplyId, setHighlightedReplyId] = useState<string | null>(null)
    const [reactionUsage, setReactionUsage] = useState<Record<string, number>>(loadReactionUsage)
    const viewportRef = useRef<HTMLDivElement>(null)
    const messageContentRef = useRef<HTMLDivElement>(null)
    const fileInputRef = useRef<HTMLInputElement>(null)
    const composerRef = useRef<HTMLTextAreaElement>(null)
    const stickToBottomRef = useRef(true)
    const swipeGestureRef = useRef<{ id: string | null; startX: number; startY: number; horizontal: boolean; dx: number }>({ id: null, startX: 0, startY: 0, horizontal: false, dx: 0 })
    const handleComposerFocus = useChatKeyboardTail({ viewportRef, composerRef, stickToBottomRef })
    // Telegram-style reply gestures: double-click or a left swipe on a
    // message bubble starts a reply to it.
    const startReply = useCallback((message: ExternalMessage) => {
        setReactionPickerFor(null)
        setReactionPickerExpanded(false)
        setReplyTo(message)
        composerRef.current?.focus({ preventScroll: true })
    }, [])
    // Window-level keydown → focus composer + insert character. Closure
    // captures the latest `setText` on every render so the typed glyph is
    // appended to the current draft instead of dropping the user's first
    // keystroke.
    useChatsComposerAutoFocus({
        composerRef,
        onInsertCharacter: (character) => setText((current) => current + character),
    })
    const conversations = useQuery({
        queryKey: queryKeys.externalConversations,
        queryFn: async () => (await api!.getExternalConversations()).conversations,
        enabled: Boolean(api)
    })
    const conversation = conversations.data?.find((item) => item.id === conversationId)
    const ownAccountAvatarUrl = conversation
        ? connections.data?.find((item) => item.provider === conversation.provider)?.accountAvatarUrl ?? null
        : null
    const messages = useExternalMessages(api, conversationId)
    const participantAvatars = useMemo(() => new Map(
        (messages.data?.participants ?? []).map((participant) => [participant.id, participant.avatarDataUrl])
    ), [messages.data?.participants])
    const frequentReactions = useMemo(() => {
        const used = Object.entries(reactionUsage)
            .filter(([emoji]) => allReactions.includes(emoji as typeof allReactions[number]))
            .sort((left, right) => right[1] - left[1])
            .map(([emoji]) => emoji)
        return Array.from(new Set([...used, ...defaultFrequentReactions])).slice(0, 6)
    }, [reactionUsage])
    const rememberReaction = useCallback((emoji: string) => {
        setReactionUsage((current) => {
            const next = { ...current, [emoji]: (current[emoji] ?? 0) + 1 }
            try {
                window.localStorage.setItem(reactionUsageStorageKey, JSON.stringify(next))
            } catch {
            }
            return next
        })
    }, [])
    const outbox = useExternalMessageOutbox(api, conversationId, messages)
    const submitMessage = (payload: Parameters<typeof outbox.send>[0]) => {
        if (!outbox.send({ ...payload, replyToProviderMessageId: replyTo?.providerMessageId })) return
        stickToBottomRef.current = true
        setText('')
        setReplyTo(null)
        if (payload.kind === 'media') {
            clearPendingMedia()
            if (fileInputRef.current) fileInputRef.current.value = ''
        }
        if (payload.kind === 'gif') setGifPickerOpen(false)
        composerRef.current?.focus({ preventScroll: true })
    }
    const setReactions = useMutation({
        mutationFn: async (input: { providerMessageId: string; selected: string[]; optimistic: ExternalReaction[] }) => {
            await api!.setExternalMessageReactions(conversationId, input.providerMessageId, input.selected)
        },
        onMutate: async (input) => {
            const queryKey = queryKeys.externalMessages(conversationId)
            await queryClient.cancelQueries({ queryKey })
            const previous = queryClient.getQueryData<ExternalMessagesResponse>(queryKey)
            queryClient.setQueryData<ExternalMessagesResponse>(queryKey, (current) => current ? {
                ...current,
                messages: current.messages.map((message) => message.providerMessageId === input.providerMessageId
                    ? { ...message, reactions: input.optimistic }
                    : message)
            } : current)
            return { previous }
        },
        onError: (_error, _input, context) => {
            if (context?.previous) {
                queryClient.setQueryData(queryKeys.externalMessages(conversationId), context.previous)
            }
        },
        onSettled: async () => {
            await queryClient.invalidateQueries({ queryKey: queryKeys.externalMessages(conversationId) })
        }
    })
    const pressButton = useMutation({
        mutationFn: async (input: { providerMessageId: string; buttonId: string }) => {
            return await api!.pressExternalMessageButton(conversationId, input.providerMessageId, input.buttonId)
        },
        onSettled: async () => {
            // The bot answers a press by editing its message (new text, new
            // keyboard) and/or sending follow-ups; refetch either way.
            await queryClient.invalidateQueries({ queryKey: queryKeys.externalMessages(conversationId) })
        }
    })
    useLayoutEffect(() => {
        stickToBottomRef.current = true
        setReactionPickerFor(null)
        setReactionPickerExpanded(false)
        setReplyTo(null)
        setHighlightedReplyId(null)
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

    useEffect(() => {
        if (!api) return
        // Tell the hub the operator has this chat open. The hub emits SeenMarker
        // for new messages and keeps the peer ✓✓ cursor fresh on every connector
        // sync event while we stay mounted. Fire and forget — any failure shows
        // up as a delayed/missing read receipt on the peer, not in our UI.
        void api.setConversationActive(conversationId, true)
        return () => {
            void api.setConversationActive(conversationId, false)
        }
    }, [api, conversationId])

    useLayoutEffect(() => {
        if (!stickToBottomRef.current) return
        const viewport = viewportRef.current
        if (!viewport) return
        const frame = requestAnimationFrame(() => {
            viewport.scrollTop = viewport.scrollHeight
        })
        return () => cancelAnimationFrame(frame)
    }, [messages.data, outbox.entries])

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
    const messageItems = [...(messages.data?.messages ?? []), ...outbox.entries.map((entry) => entry.message)]
    const outboxById = new Map(outbox.entries.map((entry) => [entry.message.id, entry]))
    const messagesByProviderId = new Map(messageItems.map((message) => [message.providerMessageId, message]))
    const scrollToMessage = (providerMessageId: string) => {
        const viewport = viewportRef.current
        const node = viewport?.querySelector<HTMLElement>(`[data-provider-message-id="${CSS.escape(providerMessageId)}"]`)
        if (!node) return
        node.scrollIntoView({ block: 'center', behavior: 'smooth' })
        setHighlightedReplyId(providerMessageId)
        window.setTimeout(() => {
            setHighlightedReplyId((current) => current === providerMessageId ? null : current)
        }, 1600)
    }

    return (
        <div className="flex h-full min-h-0 flex-col pt-[env(safe-area-inset-top)]">
            <header className="flex h-14 shrink-0 items-center gap-2 border-b border-[var(--app-border)] px-3">
                <button type="button" onClick={() => navigate({ to: props.backTo })} className="rounded-full p-2 text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)] split:hidden"><BackIcon /></button>
                <ConversationAvatar conversation={conversation} />
                <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{conversation.title}</div>
                    <div className="text-[10px] uppercase tracking-wide text-[var(--app-hint)]">{PROVIDER_LABELS[conversation.provider as ChatsProvider] ?? conversation.provider}</div>
                </div>
            </header>
            <div
                ref={viewportRef}
                onClick={() => setReactionPickerFor(null)}
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
                        const outgoing = outboxById.get(item.id)
                        const hasMedia = Boolean(item.media?.length)
                        const reactions = item.reactions ?? []
                        const chosenReactionCount = reactions.filter((reaction) => reaction.chosen).length
                        const continuesPrevious = areExternalMessagesGrouped(messageItems[index - 1], item)
                        const continuesNext = areExternalMessagesGrouped(item, messageItems[index + 1])
                        const showSenderName = incoming && !continuesPrevious && Boolean(item.senderName) && conversation.kind !== 'direct'
                        const avatarSrc = item.senderAvatarDataUrl
                            ?? (item.senderId ? participantAvatars.get(item.senderId) : null)
                            ?? (incoming && conversation.kind === 'direct' ? conversation.avatarDataUrl : null)
                            ?? (!incoming ? ownAccountAvatarUrl : null)
                        const groupedCornerClassName = incoming
                            ? cn(continuesPrevious && 'rounded-tl-[5px]', continuesNext && 'rounded-bl-[5px]')
                            : cn(continuesPrevious && 'rounded-tr-[5px]', continuesNext && 'rounded-br-[5px]')
                        const bubbleClassName = incoming
                            ? cn('happy-chat-text w-fit max-w-full rounded-2xl bg-[var(--app-secondary-bg)] px-4 py-2.5 text-[var(--app-fg)]', groupedCornerClassName)
                            : cn(getUserBubbleClassName(), 'max-w-full', groupedCornerClassName)
                        const replyTarget = item.replyToProviderMessageId
                            ? messagesByProviderId.get(item.replyToProviderMessageId)
                            : undefined
                        const quoteHeader = (() => {
                            if (!item.replyToProviderMessageId) return null
                            const name = replyTarget
                                ? (replyTarget.direction === 'outgoing' ? t('chats.reply.you') : replyTarget.senderName || null)
                                : item.replyToSenderName ?? null
                            const quote = replyTarget
                                ? (replyTarget.text.trim() || (replyTarget.media?.[0] ? mediaLabels[replyTarget.media[0].kind] : ''))
                                : item.replyToText ?? null
                            return (
                                <button
                                    type="button"
                                    onClick={(event) => {
                                        event.stopPropagation()
                                        scrollToMessage(item.replyToProviderMessageId!)
                                    }}
                                    title={t('chats.reply.action')}
                                    className="mb-1 flex max-w-full flex-col overflow-hidden rounded-lg bg-black/10 px-2 py-1 text-left dark:bg-white/15"
                                >
                                    <span className="truncate text-xs font-semibold text-[#168AC4] dark:text-[#2AABEE]">
                                        {name ?? t('chats.reply.unavailable')}
                                    </span>
                                    <span className="truncate text-xs text-[var(--app-hint)]">
                                        {quote || t('chats.reply.unavailable')}
                                    </span>
                                </button>
                            )
                        })()
                        const caption = item.text ? (
                            <div className="flex items-end gap-2">
                                <div className="min-w-0 flex-1">
                                    {showSenderName ? (
                                        <div className="mb-0.5 text-[11px] font-semibold leading-tight" style={{ color: senderNameColor(item.senderId) }}>
                                            {item.senderName}
                                        </div>
                                    ) : null}
                                    <ExternalMessageText text={item.text} />
                                </div>
                                <time
                                    dateTime={new Date(item.createdAt).toISOString()}
                                    title={new Date(item.createdAt).toLocaleString()}
                                    className="shrink-0 pb-0.5 text-[9px] leading-none opacity-60 tabular-nums"
                                >
                                    {formatTime(item.createdAt)}
                                    {outgoing
                                        ? <span className="ml-1 inline-flex align-middle"><MessageStatusIndicator
                                            status={outgoing.status}
                                            onRetry={() => outbox.retry(outgoing.input.clientId)}
                                        /></span>
                                        : !incoming && item.deliveryStatus
                                            ? <ExternalDeliveryStatus status={item.deliveryStatus} className="ml-1 align-middle" />
                                            : null}
                                </time>
                            </div>
                        ) : null
                        return (
                            <div
                                key={item.id}
                                data-provider-message-id={item.providerMessageId}
                                className={cn(
                                    'flex w-full items-end gap-2 rounded-2xl transition-colors',
                                    continuesPrevious && '-mt-1.5',
                                    incoming ? 'justify-start' : 'justify-end',
                                    highlightedReplyId === item.providerMessageId && 'bg-[#2AABEE]/10'
                                )}
                            >
                                {incoming ? (
                                    continuesNext
                                        ? <div aria-hidden="true" className="h-8 w-8 shrink-0" />
                                        : <ChatParticipantAvatar src={avatarSrc} name={item.senderName ?? conversation.title} />
                                ) : null}
                                <div
                                    className={cn('relative flex min-w-0 max-w-[min(42rem,92%)] flex-col touch-pan-y', incoming ? 'items-start' : 'items-end')}
                                    onClick={(event) => {
                                        if (optimistic || (event.target as HTMLElement).closest('button, a, input, video, audio')) return
                                        event.stopPropagation()
                                        setReactionPickerFor((current) => {
                                            const next = current === item.providerMessageId ? null : item.providerMessageId
                                            if (next) setReactionPickerExpanded(false)
                                            return next
                                        })
                                    }}
                                    onDoubleClick={(event) => {
                                        if (optimistic || (event.target as HTMLElement).closest('button, a, input, video, audio')) return
                                        event.stopPropagation()
                                        startReply(item)
                                    }}
                                    onTouchStart={(event) => {
                                        if (optimistic || event.touches.length !== 1) return
                                        const touch = event.touches[0]
                                        swipeGestureRef.current = { id: item.providerMessageId, startX: touch.clientX, startY: touch.clientY, horizontal: false, dx: 0 }
                                        event.currentTarget.style.transition = ''
                                    }}
                                    onTouchMove={(event) => {
                                        const gesture = swipeGestureRef.current
                                        if (gesture.id !== item.providerMessageId || event.touches.length !== 1) return
                                        const dx = event.touches[0].clientX - gesture.startX
                                        const dy = event.touches[0].clientY - gesture.startY
                                        if (!gesture.horizontal) {
                                            if (Math.abs(dx) < Math.abs(dy)) { gesture.id = null; return }
                                            if (Math.abs(dx) < 8) return
                                            gesture.horizontal = true
                                        }
                                        // Follow the finger leftwards only; the
                                        // bubble never drags past a short throw.
                                        gesture.dx = Math.max(dx, -96)
                                        event.currentTarget.style.transform = `translateX(${gesture.dx}px)`
                                    }}
                                    onTouchEnd={(event) => {
                                        const gesture = swipeGestureRef.current
                                        if (gesture.id !== item.providerMessageId) return
                                        swipeGestureRef.current = { id: null, startX: 0, startY: 0, horizontal: false, dx: 0 }
                                        event.currentTarget.style.transition = 'transform 150ms ease'
                                        event.currentTarget.style.transform = ''
                                        if (gesture.dx < -48) startReply(item)
                                    }}
                                    onTouchCancel={(event) => {
                                        if (swipeGestureRef.current.id !== item.providerMessageId) return
                                        swipeGestureRef.current = { id: null, startX: 0, startY: 0, horizontal: false, dx: 0 }
                                        event.currentTarget.style.transition = 'transform 150ms ease'
                                        event.currentTarget.style.transform = ''
                                    }}
                                >
                                    {hasMedia && caption ? (
                                        <div className={cn(bubbleClassName, 'overflow-hidden p-1')}>
                                            <div className="flex max-w-full flex-col gap-1.5">
                                                {item.media!.map((media, mediaIndex) => <MediaAttachment key={`${item.id}:${mediaIndex}`} media={media} galleryId={`external-media-${conversationId}`} conversationId={conversationId} providerMessageId={item.providerMessageId} mediaIndex={mediaIndex} />)}
                                            </div>
                                            <div className="px-3 pb-1.5 pt-2">{quoteHeader}{caption}</div>
                                        </div>
                                    ) : (
                                        <>
                                            {hasMedia && quoteHeader ? <div className="mb-1 flex max-w-full flex-col">{quoteHeader}</div> : null}
                                            {hasMedia ? <div className="mb-1 flex max-w-full flex-col gap-1.5">{item.media!.map((media, mediaIndex) => {
                                                const overlaysTimestamp = mediaIndex === item.media!.length - 1
                                                    && ['image', 'sticker', 'video'].includes(media.kind)
                                                return <MediaAttachment
                                                    key={`${item.id}:${mediaIndex}`}
                                                    media={media}
                                                    galleryId={`external-media-${conversationId}`}
                                                    conversationId={conversationId}
                                                    providerMessageId={item.providerMessageId}
                                                    mediaIndex={mediaIndex}
                                                    overlay={overlaysTimestamp ? (
                                                        <span className="pointer-events-none absolute bottom-2 right-2 z-10 flex items-center rounded-full bg-black/55 px-2 py-1 text-[10px] leading-none text-white shadow-sm backdrop-blur-sm tabular-nums">
                                                            {formatTime(item.createdAt)}
                                                            {!incoming && item.deliveryStatus ? <ExternalDeliveryStatus status={item.deliveryStatus} className="ml-1" /> : null}
                                                        </span>
                                                    ) : undefined}
                                                />
                                            })}</div> : null}
                                            {caption ? <div className={bubbleClassName}>{quoteHeader}{caption}</div> : null}
                                        </>
                                    )}
                                    {item.buttons && item.buttons.length > 0 && !optimistic ? (
                                        <div className={cn('mt-1 flex w-full flex-col gap-1', incoming ? 'items-start' : 'items-end')}>
                                            {item.buttons.map((row, rowIndex) => (
                                                <div key={`${item.id}:buttons:${rowIndex}`} className="flex min-w-[14rem] max-w-full flex-row gap-1">
                                                    {row.map((button) => {
                                                        const pressingThis = pressButton.isPending
                                                            && pressButton.variables?.providerMessageId === item.providerMessageId
                                                            && pressButton.variables?.buttonId === button.id
                                                        const buttonClassName = cn(
                                                            'flex-1 overflow-hidden rounded-xl border border-[var(--app-border)] bg-[var(--app-secondary-bg)] px-2 py-2 text-center text-sm font-medium leading-tight text-[var(--app-link)] transition-colors hover:bg-[var(--app-subtle-bg)]',
                                                            pressingThis && 'opacity-50'
                                                        )
                                                        if (button.kind === 'url' && button.url) {
                                                            return (
                                                                <a
                                                                    key={button.id}
                                                                    href={button.url}
                                                                    target="_blank"
                                                                    rel="noopener noreferrer"
                                                                    className={buttonClassName}
                                                                    onClick={(event) => event.stopPropagation()}
                                                                >
                                                                    {button.text}
                                                                </a>
                                                            )
                                                        }
                                                        return (
                                                            <button
                                                                type="button"
                                                                key={button.id}
                                                                disabled={pressButton.isPending}
                                                                onClick={(event) => {
                                                                    event.stopPropagation()
                                                                    pressButton.mutate({ providerMessageId: item.providerMessageId, buttonId: button.id })
                                                                }}
                                                                className={buttonClassName}
                                                            >
                                                                {button.text}
                                                            </button>
                                                        )
                                                    })}
                                                </div>
                                            ))}
                                            {pressButton.variables?.providerMessageId === item.providerMessageId ? (
                                                pressButton.error
                                                    ? <div role="alert" className="px-1 text-xs text-red-600">{pressButton.error.message}</div>
                                                    : pressButton.data?.message
                                                        ? <div className="px-1 text-xs text-[var(--app-hint)]">{pressButton.data.message}</div>
                                                        : null
                                            ) : null}
                                        </div>
                                    ) : null}
                                    {!item.text && !item.media?.some((media) => ['image', 'sticker', 'video'].includes(media.kind)) ? (
                                        <div className="mt-0.5 flex items-center gap-1 px-2 text-[9px] text-[var(--app-hint)]">
                                            {formatTime(item.createdAt)}
                                            {!incoming && item.deliveryStatus ? <ExternalDeliveryStatus status={item.deliveryStatus} /> : null}
                                        </div>
                                    ) : null}
                                    {outgoing?.error ? <div role="alert" className="mt-1 max-w-full text-xs text-red-600">{outgoing.error}</div> : null}
                                    {reactions.length > 0 ? (
                                        <div className={cn('mt-1 flex max-w-full flex-wrap items-center gap-1 px-1', incoming ? 'justify-start' : 'justify-end')}>
                                            {reactions.map((reaction) => (
                                                <button
                                                    type="button"
                                                    key={reaction.reaction}
                                                    disabled={setReactions.isPending || (!reaction.chosen && chosenReactionCount >= 3)}
                                                    onClick={(event) => {
                                                        event.stopPropagation()
                                                        setReactionPickerFor(null)
                                                        setReactions.mutate({
                                                            providerMessageId: item.providerMessageId,
                                                            ...updatedReactions(reactions, reaction.reaction, reaction.emoji)
                                                        })
                                                    }}
                                                    className={cn(
                                                        'flex h-7 items-center gap-1 overflow-hidden rounded-full border px-2 leading-none transition-colors disabled:opacity-50',
                                                        reaction.chosen
                                                            ? 'border-[#2AABEE]/60 bg-[#2AABEE]/15 text-[#168AC4]'
                                                            : 'border-[var(--app-border)] bg-[var(--app-secondary-bg)] text-[var(--app-fg)]'
                                                    )}
                                                    aria-pressed={reaction.chosen}
                                                    title={reaction.chosen ? 'Remove reaction' : 'Add reaction'}
                                                >
                                                    <span className="flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden text-base leading-5" style={{ fontFamily: emojiFontFamily }}>{displayReactionEmoji(reaction.emoji)}</span>
                                                    <span className="text-[11px] font-medium tabular-nums">{reaction.count}</span>
                                                </button>
                                            ))}
                                        </div>
                                    ) : null}
                                    {reactionPickerFor === item.providerMessageId ? (
                                        <div
                                            role="menu"
                                            aria-label="Message reactions"
                                            onClick={(event) => event.stopPropagation()}
                                            className={cn(
                                                'absolute bottom-[calc(100%+0.5rem)] z-30 border border-[var(--app-border)] bg-[var(--app-bg)] shadow-xl',
                                                reactionPickerExpanded
                                                    ? 'grid w-[min(18rem,calc(100vw-2rem))] grid-cols-7 gap-1 rounded-2xl p-2'
                                                    : 'flex items-center gap-1 rounded-full p-1.5',
                                                incoming ? 'left-0' : 'right-0'
                                            )}
                                        >
                                            <button
                                                type="button"
                                                role="menuitem"
                                                aria-label={t('chats.reply.action')}
                                                title={t('chats.reply.action')}
                                                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--app-secondary-bg)] text-[var(--app-hint)] hover:text-[var(--app-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2AABEE]"
                                                onClick={() => startReply(item)}
                                            >
                                                <ReplyIcon />
                                            </button>
                                            {(reactionPickerExpanded ? allReactions : frequentReactions).map((emoji) => {
                                                const reaction = `emoji:${emoji}`
                                                const alreadyChosen = reactions.some((current) => current.reaction === reaction && current.chosen)
                                                return (
                                                    <button
                                                        type="button"
                                                        role="menuitem"
                                                        key={emoji}
                                                        disabled={setReactions.isPending || (!alreadyChosen && chosenReactionCount >= 3)}
                                                        className={cn(
                                                            'flex h-9 min-w-0 shrink-0 items-center justify-center overflow-hidden rounded-xl text-[22px] leading-none hover:bg-[var(--app-secondary-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2AABEE] disabled:opacity-30',
                                                            reactionPickerExpanded ? 'w-full' : 'w-9',
                                                            alreadyChosen && 'bg-[#2AABEE]/15'
                                                        )}
                                                        style={{ fontFamily: emojiFontFamily }}
                                                        onClick={() => {
                                                            if (!alreadyChosen) rememberReaction(emoji)
                                                            setReactionPickerFor(null)
                                                            setReactionPickerExpanded(false)
                                                            setReactions.mutate({
                                                                providerMessageId: item.providerMessageId,
                                                                ...updatedReactions(reactions, reaction, emoji)
                                                            })
                                                        }}
                                                    >
                                                        <span className="block h-7 w-7 overflow-hidden text-center leading-7">{emoji}</span>
                                                    </button>
                                                )
                                            })}
                                            {!reactionPickerExpanded ? (
                                                <button
                                                    type="button"
                                                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--app-secondary-bg)] text-[var(--app-hint)] hover:text-[var(--app-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2AABEE]"
                                                    onClick={() => setReactionPickerExpanded(true)}
                                                    aria-label="Show all reactions"
                                                    aria-expanded="false"
                                                >
                                                    <ReactionMoreIcon expanded={false} />
                                                </button>
                                            ) : null}
                                        </div>
                                    ) : null}
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
                if (pendingMedia) {
                    submitMessage({ kind: 'media', file: pendingMedia, text })
                } else if (text.trim()) {
                    submitMessage({ kind: 'text', text: text.trim() })
                }
            }}>
                {replyTo ? (
                    <div
                        className="mx-auto mb-1 flex max-w-content items-center gap-2 rounded-xl border-l-4 border-[#2AABEE] bg-[var(--app-secondary-bg)] py-1.5 pl-2 pr-1"
                        data-testid="chats-reply-bar"
                    >
                        <div className="min-w-0 flex-1">
                            <div className="truncate text-xs font-semibold text-[#168AC4] dark:text-[#2AABEE]">
                                {replyTo.direction === 'outgoing' ? t('chats.reply.you') : replyTo.senderName || conversation.title}
                            </div>
                            <div className="truncate text-xs text-[var(--app-hint)]">
                                {replyTo.text.trim() || (replyTo.media?.[0] ? mediaLabels[replyTo.media[0].kind] : '') || t('chats.reply.unavailable')}
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={() => setReplyTo(null)}
                            aria-label={t('chats.reply.cancel')}
                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--app-hint)] hover:bg-[var(--app-bg)] hover:text-[var(--app-fg)]"
                        >×</button>
                    </div>
                ) : null}
                {pendingMedia ? (
                    <div className="mx-auto mb-1 flex max-w-content items-center gap-2 rounded-2xl border border-[var(--app-border)] bg-[var(--app-secondary-bg)] p-1.5 pl-2" data-testid="chats-pending-media">
                        {previewUrl ? (
                            <img src={previewUrl} alt="" className="h-14 w-14 shrink-0 rounded-md object-cover" />
                        ) : (
                            <div className="h-14 w-14 shrink-0 rounded-md bg-[var(--app-bg)]" />
                        )}
                        <div className="min-w-0 flex-1 text-xs">
                            <div className="truncate font-medium">{pendingMedia.name || 'Pasted image'}</div>
                            <div className="text-[var(--app-hint)]">{pendingMedia.type || 'image'}</div>
                        </div>
                        <button
                            type="button"
                            onClick={clearPendingMedia}
                            aria-label="Remove attachment"
                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--app-hint)] hover:bg-[var(--app-bg)] hover:text-[var(--app-fg)] disabled:opacity-35"
                        >×</button>
                    </div>
                ) : null}
                <div className="mx-auto flex max-w-content items-end gap-2 rounded-2xl border border-[var(--app-border)] bg-[var(--app-secondary-bg)] p-1.5 pl-3 focus-within:border-[var(--app-link)]">
                    <input
                        ref={fileInputRef}
                        type="file"
                        className="hidden"
                        onChange={(event) => {
                            const file = event.target.files?.[0]
                            // Explicit file picks send immediately, while pastes stay staged.
                            if (file) submitMessage({ kind: 'media', file, text })
                        }}
                    />
                    <button type="button" onClick={() => fileInputRef.current?.click()} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[var(--app-hint)] hover:bg-[var(--app-bg)] hover:text-[var(--app-fg)] disabled:opacity-35" title="Attach media"><AttachmentIcon /></button>
                    <button type="button" onClick={() => setGifPickerOpen(true)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[var(--app-hint)] hover:bg-[var(--app-bg)] hover:text-[var(--app-fg)] disabled:opacity-35" title="Send GIF"><GifIcon /></button>
                    <textarea
                        ref={composerRef}
                        onFocus={handleComposerFocus}
                        value={text}
                        onChange={(event) => setText(event.target.value)}
                        onPaste={(event) => {
                            // Stage the image in the composer; do NOT send.
                            // Sending happens on Enter / Send button click
                            // so a paste is no longer a one-step commit.
                            handlePendingPaste(event)
                        }}
                        onKeyDown={(event) => {
                            if (event.key === 'Escape') {
                                if (pendingMedia) {
                                    event.preventDefault()
                                    clearPendingMedia()
                                    return
                                }
                                if (replyTo) {
                                    event.preventDefault()
                                    setReplyTo(null)
                                }
                                return
                            }
                            if (event.key === 'Enter' && !event.shiftKey) {
                                event.preventDefault()
                                event.currentTarget.form?.requestSubmit()
                            }
                        }}
                        rows={1}
                        placeholder={t('chats.messagePlaceholder')}
                        className="max-h-32 min-h-9 flex-1 resize-none bg-transparent py-2 text-sm outline-none placeholder:text-[var(--app-hint)]"
                    />
                    <button type="submit" onPointerDown={(event) => event.preventDefault()} disabled={!api || (!text.trim() && !pendingMedia)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--app-button)] text-[var(--app-button-text)] disabled:opacity-35" title={t('chats.send')}><SendIcon /></button>
                </div>
                {setReactions.error ? <div className="mx-auto mt-1 max-w-content px-2 text-xs text-red-600">{setReactions.error.message}</div> : null}
            </form>
            <KlipyGifPicker
                open={gifPickerOpen}
                onOpenChange={setGifPickerOpen}
                onSelect={(gif) => submitMessage({ kind: 'gif', gif, text })}
            />
        </div>
    )
}

export function ChatConversationPage() {
    const { conversationId } = useParams({ from: '/chats/$conversationId' })
    return <ChatConversationPane conversationId={conversationId} backTo="/chats" />
}

// Same conversation, but hosted by the sessions layout: the agent-session
// sidebar stays put and the chat opens in the right-hand pane.
export function SessionChatConversationPage() {
    const { conversationId } = useParams({ from: '/sessions/chats/$conversationId' })
    return <ChatConversationPane conversationId={conversationId} backTo="/sessions" />
}
