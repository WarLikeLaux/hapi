import { SessionGroupActions } from '@/components/SessionGroupActions'
import { SessionItemActions } from '@/components/SessionItemActions'
import type { ApiClient } from '@/api/client'
import type { SessionContextId, SessionContextOptions } from '@/lib/sessionContexts'
import { resolveSessionContext } from '@/lib/sessionContexts'
import { SessionRowLayout, SessionWorkingIcon, SESSION_LIST_ITEM_CLASS } from '@/components/SessionRowLayout'
import { SessionAttentionGlyph, SessionQuestionIcon } from '@/components/SessionAttentionIndicator'
import { formatRelativeTime } from '@/lib/relativeTime'
import { useMinuteTick } from '@/hooks/useMinuteTick'
import { useNarrowViewport } from '@/hooks/useNarrowViewport'
import { usePlatform } from '@/hooks/usePlatform'
import * as Popover from '@radix-ui/react-popover'
import { AgentFlavorIcon } from '@/components/AgentFlavorIcon'
import { presentSessionGroup } from '@/lib/sessionGroups'
import { getSessionGroupMembers } from '@/lib/sessionGroupMembers'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { SessionGroup, UpdateSessionGroup } from '@hapi/protocol'
import type { SessionSummary } from '@/types/api'
import { getSessionTitle } from '@/lib/sessionTitle'
import { getSessionLastSeenAt, getSessionManualUnreadAt, useSessionLastSeenVersion } from '@/lib/sessionLastSeen'
import { classifySessionAttention, getSessionAttentionLabelKey } from '@/lib/sessionAttention'
import { useTranslation } from '@/lib/use-translation'
import { cn } from '@/lib/utils'

const control = 'min-h-9 rounded-md px-2 text-sm hover:bg-[var(--app-subtle-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)] disabled:opacity-40'
const field = 'min-h-10 min-w-0 rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)]'

export function GroupIcon({ pin = false, className }: { pin?: boolean; className?: string }) {
    return <svg className={cn('h-4 w-4 shrink-0', className)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {pin ? <path d="m9 3 6 0-1 6 4 4v2H6v-2l4-4-1-6Zm3 12v6" /> : <><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M3 9h18M9 9v11" /></>}
    </svg>
}

function ChatStatus({ session, selected = false }: { session: SessionSummary; selected?: boolean }) {
    useSessionLastSeenVersion()
    const { t } = useTranslation()
    let attention = classifySessionAttention(session, { selected, lastSeenAt: getSessionLastSeenAt(session.id), manualUnreadAt: getSessionManualUnreadAt(session.id) })
    const permission = session.pendingRequestKinds?.includes('permission')
    if (permission && !attention && !session.thinking) attention = { kind: 'permission' }
    const question = attention?.kind === 'input' || attention?.kind === 'async-input'
    const working = session.active && session.thinking && (question || attention?.kind !== 'unread')
    return <span className="flex shrink-0 items-center gap-1 text-xs text-[var(--app-hint)]">
        {working ? <span aria-label={t('groups.working')} title={t('groups.working')}><SessionWorkingIcon /></span> : null}
        {attention && (!working || question) ? <SessionAttentionGlyph attention={attention}
            label={t(getSessionAttentionLabelKey(attention))} title={t(getSessionAttentionLabelKey(attention))} /> : null}
    </span>
}

function GroupChatSwitcher({ members, selectedSessionId, onSelect }: {
    members: ReturnType<typeof getSessionGroupMembers>
    selectedSessionId: string | null
    onSelect: (id: string) => void
}) {
    const { t } = useTranslation()
    const narrow = useNarrowViewport()
    const { isTouch } = usePlatform()
    const native = narrow || isTouch
    const [open, setOpen] = useState(false)
    // Native selects can match :focus-visible even after pointer interaction.
    const [pointerFocus, setPointerFocus] = useState(false)
    const menu = useRef<HTMLDivElement>(null)
    const menuResize = useRef<ResizeObserver | null>(null)
    useEffect(() => { if (native) setOpen(false) }, [native])
    useEffect(() => () => menuResize.current?.disconnect(), [])
    const arrow = <svg className="pointer-events-none h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>

    if (native) return <>
        {arrow}
        <select aria-label={t('groups.jump')} title={t('groups.jump')}
            className={cn('absolute inset-0 w-full cursor-pointer appearance-none bg-transparent text-transparent focus:outline-none [&>option]:text-[var(--app-fg)] [&>option]:bg-[var(--app-bg)]', !pointerFocus && 'focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--app-link)]')}
            onPointerDown={() => setPointerFocus(true)} onKeyDown={() => setPointerFocus(false)} onBlur={() => setPointerFocus(false)}
            value={selectedSessionId ?? ''} onChange={event => onSelect(event.target.value)}>
            <option value="" disabled>{t('groups.jump')}</option>
            {members.map(member => <option key={member.sessionId} value={member.sessionId}>{member.pinned ? `${t('groups.pinned')}: ` : ''}{getSessionTitle(member.session)}</option>)}
        </select>
    </>

    return <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
            <button type="button" aria-label={t('groups.jump')} title={t('groups.jump')} aria-haspopup="menu"
                className="flex h-full w-full items-center justify-center hover:bg-[var(--app-subtle-bg)] data-[state=open]:bg-[var(--app-secondary-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--app-link)]"
                onKeyDown={event => {
                    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                        event.preventDefault()
                        setOpen(true)
                    }
                }}>{arrow}</button>
        </Popover.Trigger>
        <Popover.Portal>
            <Popover.Content ref={menu} role="menu" aria-label={t('groups.jump')} side="bottom" align="end" sideOffset={6} collisionPadding={8}
                className="z-50 max-h-[min(24rem,var(--radix-popover-content-available-height))] w-80 max-w-[calc(100vw-1rem)] overflow-y-auto overscroll-contain rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] p-1 text-[var(--app-fg)] shadow-lg"
                onOpenAutoFocus={event => {
                    event.preventDefault()
                    const current = menu.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')
                        ?? menu.current?.querySelector<HTMLButtonElement>('[role="menuitemradio"]')
                    current?.focus()
                    current?.scrollIntoView({ block: 'nearest' })
                    // Popover positioning can constrain the height after autofocus.
                    if (menu.current && typeof ResizeObserver !== 'undefined') {
                        menuResize.current?.disconnect()
                        menuResize.current = new ResizeObserver(() => {
                            const focused = menu.current?.querySelector<HTMLButtonElement>('[role="menuitemradio"]:focus')
                            focused?.scrollIntoView({ block: 'nearest' })
                        })
                        menuResize.current.observe(menu.current)
                    }
                }}
                onCloseAutoFocus={() => menuResize.current?.disconnect()}
                onKeyDown={event => {
                    event.stopPropagation()
                    if (event.key === 'Tab') { setOpen(false); return }
                    const items = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? [])
                    const current = items.findIndex(item => item === document.activeElement)
                    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
                        : event.key === 'ArrowDown' ? (current + 1) % items.length
                        : event.key === 'ArrowUp' ? (current + items.length - 1) % items.length : -1
                    if (next >= 0) {
                        event.preventDefault()
                        items[next]?.focus()
                        items[next]?.scrollIntoView({ block: 'nearest' })
                    }
                }}>
                {members.map(member => {
                    const selected = selectedSessionId === member.sessionId
                    return <button key={member.sessionId} type="button" role="menuitemradio" aria-checked={selected} tabIndex={-1}
                        title={getSessionTitle(member.session)}
                        className={cn('flex min-h-10 w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-[var(--app-subtle-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--app-link)]', selected && 'bg-[var(--app-secondary-bg)]')}
                        onClick={() => { setOpen(false); onSelect(member.sessionId) }}>
                        {member.pinned ? <GroupIcon pin /> : null}
                        <span className="min-w-0 flex-1 whitespace-normal break-words leading-5 [overflow-wrap:anywhere]">{getSessionTitle(member.session)}</span>
                        <ChatStatus session={member.session} selected={selected} />
                        <span className="h-4 w-4 shrink-0" aria-hidden="true">{selected ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m5 12 4 4L19 6" /></svg> : null}</span>
                    </button>
                })}
            </Popover.Content>
        </Popover.Portal>
    </Popover.Root>
}

export function SessionGroupRows(props: {
    groups: SessionGroup[]; sessions: SessionSummary[]; selectedGroupId?: string
    search: string; onOpen: (group: SessionGroup) => void
    api?: ApiClient | null; onNew?: (group: SessionGroup) => void; onHidden?: (group: SessionGroup) => void
    onActionError?: (group: SessionGroup, message: string) => void
}) {
    const { t } = useTranslation()
    useSessionLastSeenVersion()
    useMinuteTick(true)
    const query = props.search.trim().toLocaleLowerCase()
    const sessionsById = useMemo(() => new Map(props.sessions.map(session => [session.id, session])), [props.sessions])
    return <>{props.groups.map(group => {
        const { chats, partiallyClosed, questions, permissions, unread, working, flavors, section, activityAt } = presentSessionGroup(group, sessionsById, getSessionLastSeenAt, getSessionManualUnreadAt)
        if (query && ![group.name, ...chats.map(getSessionTitle)].some(name => name.toLocaleLowerCase().includes(query))) return null
        const questionLabel = t('groups.questions', { count: questions })
        const unreadLabel = t('groups.unreadCount', { count: unread })
        return <SessionGroupActions key={group.id} group={group} sessions={props.sessions} api={props.api ?? null}
            onOpen={props.onOpen} onNew={props.onNew ? () => props.onNew?.(group) : undefined} onHidden={() => props.onHidden?.(group)}
            onActionError={props.onActionError ? message => props.onActionError?.(group, message) : undefined}>
        {handlers => <button {...handlers} type="button" data-testid="session-group-row" aria-haspopup="menu"
            aria-current={props.selectedGroupId === group.id ? 'page' : undefined}
            className={cn(SESSION_LIST_ITEM_CLASS, props.selectedGroupId === group.id && 'bg-[var(--app-secondary-bg)]')}>
            <SessionRowLayout title={group.name} active={section !== 'recent' && section !== 'parked'}
                avatar={<span className="relative flex h-full w-full items-center justify-center" role="img" aria-label={flavors.length ? flavors.join(', ') : t('groups.workspace')} title={flavors.join(', ')}>
                    {flavors.length === 0 ? <GroupIcon className="h-full w-full" /> : flavors.length === 1 ? <AgentFlavorIcon flavor={flavors[0]} className="h-full w-full" avatar /> : <>
                        <span className="absolute left-0 top-0 h-6 w-6 rounded-full bg-[var(--app-bg)] p-0.5"><AgentFlavorIcon flavor={flavors[0]} className="h-full w-full" avatar /></span>
                        <span className="absolute bottom-0 right-0 h-6 w-6 rounded-full bg-[var(--app-bg)] p-0.5"><AgentFlavorIcon flavor={flavors[1]} className="h-full w-full" avatar /></span>
                        {flavors.length > 2 ? <span className="absolute -right-1 -top-1 rounded bg-[var(--app-secondary-bg)] px-0.5 text-[10px] font-medium">+{flavors.length - 2}</span> : null}
                    </>}
                </span>}
                indicators={<>
                    {working ? <span className="inline-flex shrink-0" aria-label={t('groups.working')} title={t('groups.working')}><SessionWorkingIcon /></span> : null}
                    {questions ? <SessionQuestionIcon label={questionLabel} title={questionLabel} /> : null}
                    {permissions ? <SessionAttentionGlyph attention={{ kind: 'permission' }} label={t('session.item.permission')} title={t('session.item.permission')} /> : null}
                    {unread ? <span aria-label={unreadLabel} title={unreadLabel} className="inline-flex h-2 w-2 shrink-0 rounded-full bg-[var(--app-link)]" /> : null}
                </>}
                trailing={<span className="min-w-0 truncate whitespace-nowrap tabular-nums text-[var(--app-hint)]">{formatRelativeTime(activityAt, t)}</span>}
            >
                <div className="flex min-w-0 items-center gap-2 text-xs text-[var(--app-hint)]">
                    <span className="min-w-0 truncate rounded-[5px] border border-[var(--app-border)] bg-[var(--app-secondary-bg)] px-1.5 py-px font-medium leading-tight">{t('groups.chatCount', { count: chats.length })}</span>
                    {group.closed ? <span>{t(partiallyClosed ? 'groups.closeIncomplete' : 'groups.closed')}</span> : group.parked ? <span>{t('groups.parked')}</span> : null}
                    {working ? <span className="truncate">{t('groups.workingCount', { count: working })}</span> : null}
                </div>
            </SessionRowLayout>
        </button>}
        </SessionGroupActions>
    })}</>
}

export function SessionGroupWorkspace(props: {
    api?: ApiClient | null; titleSuggestionAvailable?: boolean
    onOpenGroup?: (group: SessionGroup) => void
    contextOptions?: SessionContextOptions; onSetContext?: (id: string, context: SessionContextId | null) => void
    group: SessionGroup; groups: SessionGroup[]; sessions: SessionSummary[]; selectedSessionId: string | null
    onSelect: (id: string) => void; onBack: () => void; onNew: () => void
    onUpdate: (group: SessionGroup, patch: UpdateSessionGroup) => Promise<boolean>; pending: boolean; error?: string
}) {
    const { t } = useTranslation()
    const [manage, setManage] = useState(false)
    const [search, setSearch] = useState('')
    const [name, setName] = useState(props.group.name)
    const selectedTab = useRef<HTMLButtonElement | null>(null)
    const tabList = useRef<HTMLDivElement | null>(null)
    useEffect(() => { setName(props.group.name) }, [props.group.id, props.group.name])
    const members = props.group.members.flatMap(member => {
        const session = props.sessions.find(s => s.id === member.sessionId)
        return session && (props.group.closed || session.metadata?.lifecycleState !== 'archived') ? [{ ...member, session }] : []
    })
    const tabMembers = getSessionGroupMembers(props.group, props.sessions)
    const tabOrder = tabMembers.map(member => member.sessionId).join('\0')
    useEffect(() => {
        const reveal = () => selectedTab.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
        reveal()
        if (!tabList.current || typeof ResizeObserver === 'undefined') return
        // Badges and responsive/pinned sections can move the selected tab without reordering it.
        const resize = new ResizeObserver(reveal)
        resize.observe(tabList.current)
        for (const tab of tabList.current.querySelectorAll('[role="tab"]')) {
            resize.observe(tab)
            if (tab.parentElement) resize.observe(tab.parentElement)
        }
        return () => resize.disconnect()
    }, [props.selectedSessionId, props.group.id, tabOrder])
    const update = (members: SessionGroup['members']) => props.onUpdate(props.group, { ...props.group,
        members: members.filter(member => props.group.closed || !props.sessions.some(session => session.id === member.sessionId && session.metadata?.lifecycleState === 'archived')),
    })
    const togglePark = async () => {
        const saved = await props.onUpdate(props.group, { ...props.group, parked: !props.group.parked })
        if (saved && !props.group.parked) props.onBack()
    }
    const move = (index: number, offset: number) => {
        const member = members[index]
        const neighbor = members[index + offset]
        if (!member || !neighbor || member.pinned !== neighbor.pinned) return
        const next = [...props.group.members]
        const from = next.findIndex(item => item.sessionId === member.sessionId)
        const to = next.findIndex(item => item.sessionId === neighbor.sessionId)
        ;[next[from], next[to]] = [next[to], next[from]]
        void update(next)
    }
    const tab = (member: typeof members[number]) => <SessionItemActions key={member.sessionId}
        interaction="touch-only-native-click" session={member.session} api={props.api ?? null} onSelect={props.onSelect}
        titleSuggestionAvailable={props.titleSuggestionAvailable}
        currentContext={props.contextOptions ? resolveSessionContext(member.session, props.contextOptions) : undefined}
        onSetContext={props.onSetContext ? context => props.onSetContext?.(member.sessionId, context) : undefined}>
        {handlers => <button {...handlers} type="button" role="tab" aria-selected={props.selectedSessionId === member.sessionId}
        ref={props.selectedSessionId === member.sessionId ? selectedTab : undefined}
        title={`${getSessionTitle(member.session)} · ${member.session.metadata?.flavor ?? ''}`}
        className={cn('flex min-h-11 min-w-0 w-full shrink-0 items-center gap-1.5 border-b-2 px-2 text-sm sm:w-auto sm:max-w-56 sm:gap-2 sm:px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--app-link)]', props.selectedSessionId === member.sessionId ? 'border-[var(--app-link)] bg-[var(--app-secondary-bg)] text-[var(--app-fg)]' : 'border-transparent text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)]')}>
        {member.pinned ? <GroupIcon pin /> : null}<span className="min-w-0 flex-1 truncate text-left sm:flex-initial">{getSessionTitle(member.session)}</span><ChatStatus session={member.session} selected={props.selectedSessionId === member.sessionId} />
    </button>}
    </SessionItemActions>
    const candidates = props.sessions.filter(s => s.metadata?.lifecycleState !== 'archived' && !members.some(m => m.sessionId === s.id) && getSessionTitle(s).toLocaleLowerCase().includes(search.toLocaleLowerCase()))
    return <section aria-label={t('groups.workspace')} className="shrink-0 border-b border-[var(--app-border)] bg-[var(--app-bg)] pt-[env(safe-area-inset-top)]">
        <div className="flex min-h-11 items-center gap-2 px-2">
            <button type="button" onClick={props.onBack} className={cn(control, 'split:hidden')} aria-label={t('groups.back')}><svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m15 18-6-6 6-6" /></svg></button>
            <GroupIcon /><h2 className="min-w-0 flex-1 truncate text-sm font-semibold" title={props.group.name}>{props.group.name}</h2>
            <SessionGroupActions group={props.group} sessions={props.sessions} api={props.api ?? null}
                onOpen={props.onOpenGroup ?? (group => { if (group.members[0]) props.onSelect(group.members[0].sessionId) })}
                onNew={props.onNew} onManage={() => setManage(true)} onHidden={props.onBack}>
                {(handlers, openMenu) => <button {...handlers} type="button" onClick={openMenu} aria-label={t('groups.actions')}
                    title={t('groups.actions')} aria-haspopup="menu" className={cn(control, 'flex h-9 w-9 shrink-0 items-center justify-center px-0')}>
                    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="12" cy="19" r="1.5" /></svg>
                </button>}
            </SessionGroupActions>
            {!props.group.closed ? <button type="button" onClick={props.onNew} className={control}>{t('groups.newChat')}</button> : null}
            <button type="button" onClick={() => setManage(!manage)} aria-expanded={manage} className={cn(control, manage && 'bg-[var(--app-secondary-bg)]')}>{t('groups.manage')}</button>
            {members.length ? <div className="relative flex h-9 w-9 shrink-0 items-center justify-center">
                <GroupChatSwitcher members={tabMembers} selectedSessionId={props.selectedSessionId} onSelect={props.onSelect} />
            </div> : null}
        </div>
        {props.group.closed ? <div className="flex items-center gap-3 border-t border-[var(--app-border)] px-3 py-2">
            <p className="min-w-0 flex-1 text-xs text-[var(--app-hint)]">{t(members.some(member => member.session.active || member.session.metadata?.lifecycleState !== 'archived') ? 'groups.closeIncompleteHint' : 'groups.closedHint')}</p>
            <SessionGroupActions group={props.group} sessions={props.sessions} api={props.api ?? null}
                onOpen={props.onOpenGroup ?? (group => { if (group.members[0]) props.onSelect(group.members[0].sessionId) })}>
                {(_handlers, _openMenu, openGroup, pending) => <button type="button" disabled={pending} onClick={openGroup} className={cn(control, 'shrink-0 text-[var(--app-link)]')}>{t('groups.open')}</button>}
            </SessionGroupActions>
        </div> : null}
        {props.group.parked ? <div className="flex items-center gap-3 border-t border-[var(--app-border)] px-3 py-2">
            <p className="min-w-0 flex-1 text-xs text-[var(--app-hint)]">{t('groups.parkedHint')}</p>
            <button type="button" disabled={props.pending} onClick={() => void togglePark()}
                className={cn(control, 'shrink-0 text-[var(--app-link)]')}>{t('groups.restore')}</button>
        </div> : null}
        {members.length ? <div ref={tabList} className="grid w-full grid-cols-3 sm:flex sm:min-w-0" role="tablist" aria-label={t('groups.tabs')} onKeyDown={event => {
            if (!(event.target instanceof HTMLElement) || event.target.getAttribute('role') !== 'tab') return
            const current = tabMembers.findIndex(m => m.sessionId === props.selectedSessionId)
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabMembers.length - 1 : event.key === 'ArrowRight' ? (current + 1) % tabMembers.length : event.key === 'ArrowLeft' ? (current < 0 ? tabMembers.length - 1 : (current + tabMembers.length - 1) % tabMembers.length) : -1
            if (next >= 0) { event.preventDefault(); props.onSelect(tabMembers[next].sessionId); requestAnimationFrame(() => selectedTab.current?.focus()) }
        }}>
            {tabMembers.some(m => m.pinned) ? <div className="contents sm:flex sm:max-w-[48%] sm:shrink-0 sm:overflow-x-auto sm:border-r sm:border-[var(--app-border)]" aria-label={t('groups.pinned')}>{tabMembers.filter(m => m.pinned).map(tab)}</div> : null}
            <div className="contents sm:flex sm:min-w-0 sm:flex-1 sm:overflow-x-auto">{tabMembers.filter(m => !m.pinned).map(tab)}</div>
        </div> : <p className="px-4 pb-3 text-sm text-[var(--app-hint)]">{t('groups.empty')} <button type="button" onClick={() => setManage(true)} className="text-[var(--app-link)] underline">{t('groups.addChats')}</button></p>}
        {manage ? <div className="max-h-[50dvh] overflow-y-auto border-t border-[var(--app-border)] px-3 py-3" data-testid="group-manager">
            <form className="mb-3 flex items-end gap-2" onSubmit={e => { e.preventDefault(); void props.onUpdate(props.group, { ...props.group, name: name.trim() }) }}>
                <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-[var(--app-hint)]">{t('groups.name')}<input className={field} value={name} maxLength={120} onChange={e => setName(e.target.value)} /></label>
                <button disabled={props.pending || !name.trim() || name.trim() === props.group.name} className={control}>{t('groups.saveName')}</button>
            </form>
            <p className="mb-2 text-xs text-[var(--app-hint)]">{t('groups.orderHint')}</p>
            {members.map((member, index) => <div key={member.sessionId} className="flex flex-wrap items-center gap-1 border-b border-[var(--app-border)] py-1" data-testid="group-member">
                <button type="button" onClick={() => props.onSelect(member.sessionId)} className="min-w-0 flex-1 truncate px-1 text-left text-sm" title={getSessionTitle(member.session)}>{getSessionTitle(member.session)}<span className="ml-2 text-xs text-[var(--app-hint)]">{member.session.metadata?.flavor}</span></button>
                <ChatStatus session={member.session} selected={props.selectedSessionId === member.sessionId} />
                <button type="button" aria-label={t(member.pinned ? 'groups.unpin' : 'groups.pin')} title={t(member.pinned ? 'groups.unpin' : 'groups.pin')} aria-pressed={member.pinned} disabled={props.pending}
                    className={cn(control, member.pinned && 'text-[var(--app-link)] bg-[var(--app-secondary-bg)]')} onClick={() => void update(props.group.members.map(m => m.sessionId === member.sessionId ? { ...m, pinned: !m.pinned } : m))}><GroupIcon pin /></button>
                <button type="button" className={control} aria-label={t('groups.moveLeft')} disabled={props.pending || index === 0 || members[index - 1]?.pinned !== member.pinned} onClick={() => move(index, -1)}><svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m15 18-6-6 6-6" /></svg></button>
                <button type="button" className={control} aria-label={t('groups.moveRight')} disabled={props.pending || index === members.length - 1 || members[index + 1]?.pinned !== member.pinned} onClick={() => move(index, 1)}><svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m9 18 6-6-6-6" /></svg></button>
                <select aria-label={t('groups.moveChat', { name: getSessionTitle(member.session) })} value={props.group.id} disabled={props.pending} className={cn(field, 'w-28 px-1')} onChange={e => {
                    const target = props.groups.find(g => g.id === e.target.value)
                    if (target) void props.onUpdate(target, { ...target, members: [...target.members, { sessionId: member.sessionId, pinned: false }] })
                    else void update(props.group.members.filter(m => m.sessionId !== member.sessionId))
                }}><option value="">{t('groups.standalone')}</option>{props.groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select>
            </div>)}
            <label className="mt-4 flex flex-col gap-1 text-sm">{t('groups.addChats')}<input className={field} placeholder={t('groups.findChat')} value={search} onChange={e => setSearch(e.target.value)} /></label>
            <div className="mt-2 max-h-40 overflow-y-auto">
                {candidates.map(session => { const previous = props.groups.find(g => g.members.some(m => m.sessionId === session.id)); return <div key={session.id} className="flex items-center gap-2 py-1">
                    <span className="min-w-0 flex-1 truncate text-sm">{getSessionTitle(session)}<span className="ml-2 text-xs text-[var(--app-hint)]">{previous?.name ?? session.metadata?.flavor}</span></span>
                    <button type="button" disabled={props.pending} className={cn(control, 'text-[var(--app-link)]')} onClick={() => void update([...props.group.members, { sessionId: session.id, pinned: false }])}>{t(previous ? 'groups.moveHere' : 'groups.add')}</button>
                </div> })}
                {!candidates.length ? <p className="py-2 text-sm text-[var(--app-hint)]">{t('groups.noChats')}</p> : null}
            </div>
        </div> : null}
        {props.error ? <p role="alert" className="px-3 py-2 text-sm text-red-600">{props.error}</p> : null}
    </section>
}
