import { useCallback, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useIsMutating, useMutation, useQueryClient } from '@tanstack/react-query'
import { isSessionBusy, type SessionGroup } from '@hapi/protocol'
import type { ApiClient } from '@/api/client'
import type { SessionSummary } from '@/types/api'
import { useAnchoredMenu } from '@/hooks/useAnchoredMenu'
import { useLongPress } from '@/hooks/useLongPress'
import { usePlatform } from '@/hooks/usePlatform'
import { sessionGroupsKey } from '@/hooks/queries/useSessionGroups'
import { queryKeys } from '@/lib/query-keys'
import { getSessionTitle } from '@/lib/sessionTitle'
import { useTranslation } from '@/lib/use-translation'
import { cn } from '@/lib/utils'
import { ACTION_MENU_CLASS, ACTION_MENU_HEADING_CLASS, ACTION_MENU_ITEM_CLASS, EditIcon, StopIcon, ReopenIcon } from '@/components/ActionMenuPrimitives'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

function PlusIcon() {
    return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 5v14M5 12h14" />
    </svg>
}

function SettingsIcon() {
    return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 7h7m4 0h5M4 17h3m4 0h9" /><circle cx="13" cy="7" r="2" /><circle cx="9" cy="17" r="2" />
    </svg>
}

function HistoryIcon() {
    return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
    </svg>
}

type Action = { type: 'park' | 'restore' | 'close' | 'reopen' } | { type: 'rename'; name: string }

/** Group-level commands shared by sidebar rows and the workspace header. */
export function SessionGroupActions(props: {
    group: SessionGroup
    sessions: SessionSummary[]
    api: ApiClient | null
    onOpen: (group: SessionGroup) => void
    onNew?: () => void
    onManage?: () => void
    onHidden?: () => void
    onActionError?: (message: string) => void
    children: (handlers: ReturnType<typeof useLongPress>, openMenu: (event: MouseEvent<HTMLElement>) => void, openGroup: () => void, pending: boolean) => ReactNode
}) {
    const { group, api } = props
    const { t } = useTranslation()
    const client = useQueryClient()
    const { haptic } = usePlatform()
    const trigger = useRef<HTMLElement | null>(null)
    const [point, setPoint] = useState<{ x: number; y: number } | null>(null)
    const [closeOpen, setCloseOpen] = useState(false)
    const [renameOpen, setRenameOpen] = useState(false)
    const [name, setName] = useState(group.name)
    const [error, setError] = useState<string | null>(null)
    const closeMenu = useCallback(() => { setPoint(null); trigger.current?.focus() }, [])
    const { menuRef, menuStyle } = useAnchoredMenu({ isOpen: Boolean(point), onClose: closeMenu, anchorPoint: point ?? { x: 0, y: 0 }, align: 'start' })
    const mutationKey = ['group-action', group.id]
    const pending = useIsMutating({ mutationKey }) > 0
    const mutation = useMutation({
        mutationKey,
        mutationFn: async (action: Action) => {
            if (!api) throw new Error(t('dialog.error.default'))
            if (action.type !== 'rename') {
                const result = await api.changeGroupLifecycle(group.id, group.version, action.type === 'restore' ? 'reopen' : action.type)
                if (result.failures.length) {
                    throw new Error(result.failures.map(failure => {
                        const chat = props.sessions.find(session => session.id === failure.sessionId)
                        return `${chat ? getSessionTitle(chat) : failure.sessionId}: ${failure.message}`
                    }).join('\n'))
                }
                return result.group
            }
            return (await api.updateGroup(group.id, { ...group,
                name: action.name,
            })).group
        },
        onSuccess: (saved, action) => {
            client.setQueryData<{ groups: SessionGroup[] }>(sessionGroupsKey, previous => previous
                ? { groups: previous.groups.map(item => item.id === saved.id ? saved : item) } : previous)
            if (action.type === 'park' || action.type === 'close') props.onHidden?.()
            if (action.type === 'reopen' || action.type === 'restore') props.onOpen(saved)
        },
        onError: error => props.onActionError?.(error.message),
        onSettled: async () => {
            await Promise.all([
                client.invalidateQueries({ queryKey: sessionGroupsKey }),
                client.invalidateQueries({ queryKey: queryKeys.sessions }),
                ...group.members.map(member => client.invalidateQueries({ queryKey: queryKeys.session(member.sessionId) })),
            ])
        },
    })
    const run = async (action: Action) => {
        if (pending) return
        setError(null)
        try { await mutation.mutateAsync(action) }
        catch (error) { if (!props.onActionError) setError(error instanceof Error ? error.message : t('dialog.error.default')) }
    }
    const longPress = useLongPress({
        interaction: 'touch-only-native-click',
        onClick: () => props.onOpen(group),
        onLongPress: point => { haptic.impact('medium'); setPoint(point) },
    })
    const handlers: ReturnType<typeof useLongPress> = {
        ...longPress,
        onTouchStart: event => { trigger.current = event.currentTarget as HTMLElement; longPress.onTouchStart(event) },
        onContextMenu: event => {
            event.preventDefault()
            event.stopPropagation()
            trigger.current = event.currentTarget as HTMLElement
            setPoint({ x: event.clientX, y: event.clientY })
        },
        onKeyDown: event => {
            if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
                event.preventDefault()
                trigger.current = event.currentTarget as HTMLElement
                const rect = trigger.current.getBoundingClientRect()
                setPoint({ x: rect.left, y: rect.bottom })
            }
        },
    }
    const openMenu = (event: MouseEvent<HTMLElement>) => {
        trigger.current = event.currentTarget
        const rect = event.currentTarget.getBoundingClientRect()
        setPoint({ x: rect.left, y: rect.bottom })
    }
    const item = (label: string, icon: ReactNode, action: () => void, destructive = false, needsApi = false, hint?: string, disabled = false) => <button type="button" role="menuitem"
        title={hint} disabled={disabled || pending || (needsApi && !api)}
        className={cn(ACTION_MENU_ITEM_CLASS, 'disabled:opacity-50', destructive ? 'text-red-500 hover:bg-red-500/10' : 'hover:bg-[var(--app-subtle-bg)]')}
        onClick={() => { closeMenu(); action() }}>
        <span className={cn('inline-flex h-[18px] w-[18px] shrink-0', destructive ? 'text-red-500' : 'text-[var(--app-hint)]')} aria-hidden="true">{icon}</span>
        <span>{label}{disabled && hint ? <span className="mt-0.5 block max-w-64 whitespace-normal text-xs font-normal text-[var(--app-hint)]">{hint}</span> : null}</span>
    </button>
    const parkBlocked = group.members.some(member => {
        const chat = props.sessions.find(session => session.id === member.sessionId)
        return !chat || isSessionBusy(chat)
    })
    const hasOpenChats = group.members.some(member => {
        const chat = props.sessions.find(session => session.id === member.sessionId)
        return chat && (chat.active || chat.metadata?.lifecycleState !== 'archived')
    })
    return <>
        {props.children(handlers, openMenu, () => group.closed || group.parked ? void run({ type: 'reopen' }) : props.onOpen(group), pending)}
        {point ? createPortal(<div ref={menuRef} style={menuStyle} role="menu" aria-label={t('groups.actions')}
            className={cn(ACTION_MENU_CLASS, 'text-[var(--app-fg)]')}
            onKeyDown={event => {
                const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])
                const index = items.indexOf(document.activeElement as HTMLButtonElement)
                const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
                    : event.key === 'ArrowDown' ? (index + 1) % items.length
                    : event.key === 'ArrowUp' ? (index + items.length - 1) % items.length : -1
                if (next >= 0) {
                    event.preventDefault()
                    event.stopPropagation()
                    items[next]?.focus()
                    items[next]?.scrollIntoView({ block: 'nearest' })
                }
                if (event.key === 'Tab') closeMenu()
            }}>
            <div className={ACTION_MENU_HEADING_CLASS}>{t('session.more')}</div>
            {item(t('groups.open'), <ReopenIcon />, () => group.closed || group.parked ? void run({ type: 'reopen' }) : props.onOpen(group), false, group.closed || group.parked)}
            {group.closed ? item(t('groups.viewHistory'), <HistoryIcon />, () => props.onOpen(group)) : null}
            {!group.closed && props.onNew ? item(t('groups.newChat'), <PlusIcon />, props.onNew) : null}
            {props.onManage ? item(t('groups.manage'), <SettingsIcon />, props.onManage) : null}
            {item(t('groups.rename'), <EditIcon />, () => { setError(null); setName(group.name); setRenameOpen(true) }, false, true)}
            {!group.closed ? item(t(group.parked ? 'groups.restore' : 'groups.park'), group.parked ? <ReopenIcon /> : <StopIcon />, () => void run({ type: group.parked ? 'restore' : 'park' }), false, true, group.parked ? undefined : t(parkBlocked ? 'groups.parkBusy' : 'groups.parkHint'), !group.parked && parkBlocked) : null}
            {!group.closed || hasOpenChats ? item(t('groups.close'), <StopIcon />, () => setCloseOpen(true), true, true) : null}
        </div>, document.body) : null}
        <ConfirmDialog isOpen={closeOpen} onClose={() => setCloseOpen(false)} title={t('groups.close')}
            description={t('groups.closeDescription', { name: group.name, count: group.members.length })}
            confirmLabel={t('groups.close')} confirmingLabel={t('groups.closing')} isPending={pending}
            onConfirm={async () => {
                const closing = mutation.mutateAsync({ type: 'close' })
                if (props.onActionError) await closing.catch(() => {})
                else await closing
            }} destructive centerTitle />
        <Dialog open={renameOpen} onOpenChange={open => { setRenameOpen(open); setError(null) }}>
            <DialogContent className="max-w-sm"><DialogHeader><DialogTitle>{t('groups.rename')}</DialogTitle></DialogHeader>
                <form className="flex flex-col gap-3" onSubmit={event => { event.preventDefault(); void mutation.mutateAsync({ type: 'rename', name: name.trim() }).then(() => setRenameOpen(false)).catch(error => { if (props.onActionError) setRenameOpen(false); else setError(error.message) }) }}>
                    <label className="flex flex-col gap-1 text-sm">{t('groups.name')}<input autoFocus maxLength={120} value={name} onChange={event => setName(event.target.value)} className="min-h-10 rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] px-3" /></label>
                    {error ? <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
                    <Button type="submit" disabled={pending || !name.trim()}>{t('groups.saveName')}</Button>
                </form>
            </DialogContent>
        </Dialog>
        {error && !renameOpen ? <ConfirmDialog isOpen onClose={() => setError(null)} title={t('groups.actionError')} description={error}
            confirmLabel={t('dialog.reopen.dismiss')} confirmingLabel={t('dialog.reopen.dismiss')} isPending={false}
            onConfirm={async () => setError(null)} centerTitle /> : null}
    </>
}
