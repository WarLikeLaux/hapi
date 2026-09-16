import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Outlet, useLocation, useNavigate, useParams } from '@tanstack/react-router'
import type { ExternalConversation, MessengerConnection, SubmitMessengerAuthRequest } from '@hapi/protocol/messengers'
import { MarkdownRenderer } from '@/components/MarkdownRenderer'
import { PrimarySectionNav } from '@/components/PrimarySectionNav'
import { getUserBubbleClassName } from '@/components/AssistantChat/messages/user-bubble'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { useSidebarResize } from '@/hooks/useSidebarResize'
import { useAppContext } from '@/lib/app-context'
import { queryKeys } from '@/lib/query-keys'
import { useTranslation } from '@/lib/use-translation'
import { cn } from '@/lib/utils'

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

function formatTime(value: number | null): string {
    if (!value) return ''
    const date = new Date(value)
    const now = new Date()
    if (date.toDateString() === now.toDateString()) {
        return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(date)
    }
    return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date)
}

function ConversationAvatar({ conversation }: { conversation: ExternalConversation }) {
    const initials = conversation.title.trim().slice(0, 2).toUpperCase() || 'TG'
    return (
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#2AABEE]/15 text-xs font-semibold text-[#229ED9]">
            {initials}
        </div>
    )
}

function ConnectionDialog(props: { connection: MessengerConnection; onClose: () => void }) {
    const { api } = useAppContext()
    const { t } = useTranslation()
    const queryClient = useQueryClient()
    const [apiId, setApiId] = useState('')
    const [apiHash, setApiHash] = useState('')
    const [authValue, setAuthValue] = useState('')
    const [selected, setSelected] = useState<Set<string>>(new Set())
    const [error, setError] = useState<string | null>(null)
    const ready = props.connection.state === 'ready'
    const candidates = useQuery({
        queryKey: queryKeys.messengerCandidates('telegram'),
        queryFn: async () => (await api!.getMessengerCandidates('telegram')).conversations,
        enabled: Boolean(api && ready)
    })

    useEffect(() => {
        if (candidates.data) {
            setSelected(new Set(candidates.data.filter((item) => item.selected).map((item) => item.remoteId)))
        }
    }, [candidates.data])

    const configure = useMutation({
        mutationFn: async () => api!.configureTelegram({ apiId: Number(apiId), apiHash }),
        onSuccess: ({ connection }) => {
            queryClient.setQueryData(queryKeys.messengerConnections, { connections: [connection] })
            setError(null)
        },
        onError: (cause) => setError(cause instanceof Error ? cause.message : t('dialog.error.default'))
    })
    const submitAuth = useMutation({
        mutationFn: async (input: SubmitMessengerAuthRequest) => api!.submitMessengerAuth('telegram', input),
        onSuccess: ({ connection }) => {
            queryClient.setQueryData(queryKeys.messengerConnections, { connections: [connection] })
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
                            <div className="space-y-1">
                                {candidates.data?.map((conversation) => (
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
                                className="mt-4 w-full rounded-xl bg-[var(--app-link)] px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"
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
                            <button type="submit" disabled={!authValue || submitAuth.isPending} className="mt-3 w-full rounded-xl bg-[var(--app-link)] px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">
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
                            <button type="submit" disabled={!apiId || !apiHash || configure.isPending} className="mt-3 w-full rounded-xl bg-[var(--app-link)] px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">
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
    const bottomRef = useRef<HTMLDivElement>(null)
    const conversations = useQuery({
        queryKey: queryKeys.externalConversations,
        queryFn: async () => (await api!.getExternalConversations()).conversations,
        enabled: Boolean(api)
    })
    const conversation = conversations.data?.find((item) => item.id === conversationId)
    const messages = useQuery({
        queryKey: queryKeys.externalMessages(conversationId),
        queryFn: async () => (await api!.getExternalMessages(conversationId)).messages,
        enabled: Boolean(api)
    })
    const send = useMutation({
        mutationFn: async (value: string) => api!.sendExternalMessage(conversationId, value, crypto.randomUUID()),
        onSuccess: async () => {
            setText('')
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: queryKeys.externalMessages(conversationId) }),
                queryClient.invalidateQueries({ queryKey: queryKeys.externalConversations })
            ])
        }
    })
    useEffect(() => {
        bottomRef.current?.scrollIntoView({ block: 'end' })
    }, [messages.data?.length])

    if (!conversation && conversations.isLoading) {
        return <div className="m-auto text-sm text-[var(--app-hint)]">{t('loading')}</div>
    }
    if (!conversation) {
        return <div className="m-auto text-sm text-[var(--app-hint)]">{t('chats.notFound')}</div>
    }

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
            <div className="min-h-0 flex-1 overflow-y-auto bg-[var(--app-chat-bg,var(--app-bg))] px-3 py-5">
                <div className="mx-auto flex w-full max-w-content flex-col gap-2">
                    {messages.isLoading ? <div className="py-10 text-center text-sm text-[var(--app-hint)]">{t('loading.messages')}</div> : null}
                    {messages.data?.map((item) => (
                        <div key={item.id} className={cn('flex flex-col', item.direction === 'outgoing' ? 'items-end' : 'items-start')}>
                            {item.direction === 'incoming' && item.senderName && conversation.kind !== 'direct' ? <div className="mb-1 px-2 text-[10px] text-[var(--app-hint)]">{item.senderName}</div> : null}
                            <div className={item.direction === 'outgoing'
                                ? getUserBubbleClassName()
                                : 'happy-chat-text w-fit max-w-[92%] rounded-2xl bg-[var(--app-secondary-bg)] px-4 py-2.5 text-[var(--app-fg)]'}>
                                <MarkdownRenderer content={item.text} preserveSingleLineBreaks />
                            </div>
                            <div className="mt-0.5 px-2 text-[9px] text-[var(--app-hint)]">{formatTime(item.createdAt)}</div>
                        </div>
                    ))}
                    <div ref={bottomRef} />
                </div>
            </div>
            <form className="shrink-0 border-t border-[var(--app-border)] bg-[var(--app-bg)] p-2 pb-[max(.5rem,env(safe-area-inset-bottom))]" onSubmit={(event) => {
                event.preventDefault()
                const value = text.trim()
                if (value && !send.isPending) send.mutate(value)
            }}>
                <div className="mx-auto flex max-w-content items-end gap-2 rounded-2xl border border-[var(--app-border)] bg-[var(--app-secondary-bg)] p-1.5 pl-3 focus-within:border-[var(--app-link)]">
                    <textarea
                        value={text}
                        onChange={(event) => setText(event.target.value)}
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
                    <button type="submit" disabled={!text.trim() || send.isPending} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--app-link)] text-white disabled:opacity-35" title={t('chats.send')}><SendIcon /></button>
                </div>
                {send.error ? <div className="mx-auto mt-1 max-w-content px-2 text-xs text-red-600">{send.error.message}</div> : null}
            </form>
        </div>
    )
}
