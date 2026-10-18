import { SessionRowLayout, SessionWorkingIcon, SESSION_LIST_ITEM_CLASS } from '@/components/SessionRowLayout'
import { SessionQuestionIcon } from '@/components/SessionAttentionIndicator'
import { formatRelativeTime } from '@/lib/relativeTime'
import { useMinuteTick } from '@/hooks/useMinuteTick'
import { AgentFlavorIcon } from '@/components/AgentFlavorIcon'
import { presentSessionGroup } from '@/lib/sessionGroups'
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

function useChatStatus(session: SessionSummary, selected = false) {
    useSessionLastSeenVersion()
    const { t } = useTranslation()
    const attention = classifySessionAttention(session, { selected, lastSeenAt: getSessionLastSeenAt(session.id), manualUnreadAt: getSessionManualUnreadAt(session.id) })
    const permission = session.pendingRequestKinds?.includes('permission')
    const question = permission || (attention && ['input', 'async-input', 'permission'].includes(attention.kind))
    const label = permission && (!attention || attention.kind === 'unread') ? t('session.item.permission') : attention ? t(getSessionAttentionLabelKey(attention)) : session.thinking ? t('groups.working') : session.active ? t('groups.idle') : t('groups.archived')
    return { label, question, unread: attention?.kind === 'unread', working: session.thinking }
}

function ChatStatus({ session, selected = false }: { session: SessionSummary; selected?: boolean }) {
    const status = useChatStatus(session, selected)
    const { t } = useTranslation()
    return <span title={status.label} aria-label={status.label} className={cn('flex shrink-0 items-center gap-1 text-xs', status.question ? 'text-[var(--app-badge-warning-text)]' : 'text-[var(--app-hint)]')}>
        {status.question ? <span className="font-semibold">?</span> : status.working ? <svg className="h-3 w-3 motion-safe:animate-spin" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="5" stroke="currentColor" strokeWidth="2" strokeDasharray="23 9" /></svg> : null}
        {status.unread ? <span aria-label={t('session.item.newActivity')} className="h-2 w-2 rounded-full bg-[var(--app-link)]" /> : null}
    </span>
}

export function SessionGroupRows(props: {
    groups: SessionGroup[]; sessions: SessionSummary[]; selectedGroupId?: string
    search: string; onOpen: (group: SessionGroup) => void
}) {
    const { t } = useTranslation()
    useSessionLastSeenVersion()
    useMinuteTick(true)
    const query = props.search.trim().toLocaleLowerCase()
    const sessionsById = useMemo(() => new Map(props.sessions.map(session => [session.id, session])), [props.sessions])
    return <>{props.groups.map(group => {
        const { chats, questions, unread, working, flavors, section, activityAt } = presentSessionGroup(group, sessionsById, getSessionLastSeenAt, getSessionManualUnreadAt)
        if (query && ![group.name, ...chats.map(getSessionTitle)].some(name => name.toLocaleLowerCase().includes(query))) return null
        const questionLabel = t('groups.questions', { count: questions })
        const unreadLabel = t('groups.unreadCount', { count: unread })
        return <button key={group.id} type="button" onClick={() => props.onOpen(group)} data-testid="session-group-row"
            aria-current={props.selectedGroupId === group.id ? 'page' : undefined}
            className={cn(SESSION_LIST_ITEM_CLASS, props.selectedGroupId === group.id && 'bg-[var(--app-secondary-bg)]')}>
            <SessionRowLayout title={group.name} active={section !== 'recent'}
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
                    {unread ? <span aria-label={unreadLabel} title={unreadLabel} className="inline-flex h-2 w-2 shrink-0 rounded-full bg-[var(--app-link)]" /> : null}
                </>}
                trailing={<span className="min-w-0 truncate whitespace-nowrap tabular-nums text-[var(--app-hint)]">{formatRelativeTime(activityAt, t)}</span>}
            >
                <div className="flex min-w-0 items-center gap-2 text-xs text-[var(--app-hint)]">
                    <span className="min-w-0 truncate rounded-[5px] border border-[var(--app-border)] bg-[var(--app-secondary-bg)] px-1.5 py-px font-medium leading-tight">{t('groups.chatCount', { count: chats.length })}</span>
                    {working ? <span className="truncate">{t('groups.workingCount', { count: working })}</span> : null}
                </div>
            </SessionRowLayout>
        </button>
    })}</>
}

export function SessionGroupWorkspace(props: {
    group: SessionGroup; groups: SessionGroup[]; sessions: SessionSummary[]; selectedSessionId: string | null
    onSelect: (id: string) => void; onBack: () => void; onNew: () => void
    onUpdate: (group: SessionGroup, patch: UpdateSessionGroup) => Promise<void>; pending: boolean; error?: string
}) {
    const { t } = useTranslation()
    const [manage, setManage] = useState(false)
    const [search, setSearch] = useState('')
    const [name, setName] = useState(props.group.name)
    const selectedTab = useRef<HTMLButtonElement | null>(null)
    useEffect(() => { setName(props.group.name) }, [props.group.id, props.group.name])
    useEffect(() => { selectedTab.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' }) }, [props.selectedSessionId, props.group.id])
    const members = props.group.members.flatMap(member => {
        const session = props.sessions.find(s => s.id === member.sessionId)
        return session ? [{ ...member, session }] : []
    })
    const update = (members: SessionGroup['members']) => props.onUpdate(props.group, { ...props.group, members })
    const move = (index: number, offset: number) => {
        const next = [...props.group.members]
        const swap = index + offset
        if (swap < 0 || swap >= next.length || next[index].pinned !== next[swap].pinned) return
        ;[next[index], next[swap]] = [next[swap], next[index]]
        void update(next)
    }
    const tab = (member: typeof members[number]) => <button key={member.sessionId} type="button" role="tab" aria-selected={props.selectedSessionId === member.sessionId}
        ref={props.selectedSessionId === member.sessionId ? selectedTab : undefined}
        onClick={() => props.onSelect(member.sessionId)} title={`${getSessionTitle(member.session)} · ${member.session.metadata?.flavor ?? ''}`}
        className={cn('flex min-h-11 max-w-56 shrink-0 items-center gap-2 border-b-2 px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--app-link)]', props.selectedSessionId === member.sessionId ? 'border-[var(--app-link)] bg-[var(--app-secondary-bg)] text-[var(--app-fg)]' : 'border-transparent text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)]')}>
        {member.pinned ? <GroupIcon pin /> : null}<span className="truncate">{getSessionTitle(member.session)}</span><ChatStatus session={member.session} selected={props.selectedSessionId === member.sessionId} />
    </button>
    const candidates = props.sessions.filter(s => s.metadata?.lifecycleState !== 'archived' && !members.some(m => m.sessionId === s.id) && getSessionTitle(s).toLocaleLowerCase().includes(search.toLocaleLowerCase()))
    return <section aria-label={t('groups.workspace')} className="shrink-0 border-b border-[var(--app-border)] bg-[var(--app-bg)] pt-[env(safe-area-inset-top)]">
        <div className="flex min-h-11 items-center gap-2 px-2">
            <button type="button" onClick={props.onBack} className={cn(control, 'split:hidden')} aria-label={t('groups.back')}><svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m15 18-6-6 6-6" /></svg></button>
            <GroupIcon /><h2 className="min-w-0 flex-1 truncate text-sm font-semibold" title={props.group.name}>{props.group.name}</h2>
            <button type="button" onClick={props.onNew} className={control}>{t('groups.newChat')}</button>
            <button type="button" onClick={() => setManage(!manage)} aria-expanded={manage} className={cn(control, manage && 'bg-[var(--app-secondary-bg)]')}>{t('groups.manage')}</button>
        </div>
        {members.length ? <div className="flex min-w-0 flex-col sm:flex-row" role="tablist" aria-label={t('groups.tabs')} onKeyDown={event => {
            if (event.target instanceof HTMLSelectElement) return
            const current = members.findIndex(m => m.sessionId === props.selectedSessionId)
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? members.length - 1 : event.key === 'ArrowRight' ? (current + 1) % members.length : event.key === 'ArrowLeft' ? (current < 0 ? members.length - 1 : (current + members.length - 1) % members.length) : -1
            if (next >= 0) { event.preventDefault(); props.onSelect(members[next].sessionId); requestAnimationFrame(() => selectedTab.current?.focus()) }
        }}>
            {members.some(m => m.pinned) ? <div className="flex max-w-full shrink-0 overflow-x-auto border-b border-[var(--app-border)] sm:max-w-[48%] sm:border-b-0 sm:border-r" aria-label={t('groups.pinned')}>{members.filter(m => m.pinned).map(tab)}</div> : null}
            <div className="flex min-w-0 flex-1">
            <div className="flex min-w-0 flex-1 overflow-x-auto">{members.filter(m => !m.pinned).map(tab)}</div>
            <div className="relative flex w-10 shrink-0 items-center justify-center">
            <svg className="pointer-events-none absolute h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
            <select aria-label={t('groups.jump')} title={t('groups.jump')} className="absolute inset-0 w-full cursor-pointer appearance-none bg-transparent text-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--app-link)] [&>option]:text-[var(--app-fg)] [&>option]:bg-[var(--app-bg)]" value={props.selectedSessionId ?? ''} onChange={e => props.onSelect(e.target.value)}>
                <option value="" disabled>{t('groups.jump')}</option>{members.map(m => <option key={m.sessionId} value={m.sessionId}>{m.pinned ? `${t('groups.pinned')}: ` : ''}{getSessionTitle(m.session)}</option>)}
            </select></div></div>
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
