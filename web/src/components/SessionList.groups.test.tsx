import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ApiClient } from '@/api/client'
import type { SessionGroup } from '@hapi/protocol'
import type { SessionSummary } from '@/types/api'
import { I18nProvider } from '@/lib/i18n-context'
import { AppContextTestProvider } from '@/test/app-context'
import { ToastProvider } from '@/lib/toast-context'
import { markSessionSeen } from '@/lib/sessionLastSeen'
import { SessionList } from './SessionList'

afterEach(() => { cleanup(); localStorage.clear() })

function chat(id: string, overrides: Partial<SessionSummary> = {}): SessionSummary {
    return { id, active: true, thinking: true, activeAt: 1000, updatedAt: 2000, lastAgentMessageAt: 2000,
        metadata: { path: '/work', name: id, flavor: 'codex' }, metadataVersion: 1, agentStateVersion: 1,
        todosUpdatedAt: 0, todoProgress: null, pendingRequestsCount: 0, pendingRequestKinds: [], pendingRequests: [],
        backgroundTaskCount: 0, futureScheduledMessageCount: 0, nextScheduledAt: null, model: null, effort: null, ...overrides }
}

function mount(chats: SessionSummary[], standalone: SessionSummary[] = [], parked = false) {
    const group: SessionGroup = { id: 'hapi', name: 'HAPI', closed: false, parked, version: 1, updatedAt: 1000,
        members: chats.map(session => ({ sessionId: session.id, pinned: false })) }
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const tree = (sessions: SessionSummary[], standaloneSessions = standalone) => <QueryClientProvider client={client}><ToastProvider><I18nProvider><AppContextTestProvider>
        <SessionList sessions={standaloneSessions} groupedSessions={sessions} sessionGroups={[group]} hasGroupRows
            onSelect={vi.fn()} onSelectGroup={vi.fn()} onNewSession={vi.fn()} onRefresh={vi.fn()} isLoading={false} api={null} renderHeader={false} />
    </AppContextTestProvider></I18nProvider></ToastProvider></QueryClientProvider>
    const view = render(tree(chats))
    return (sessions: SessionSummary[], standaloneSessions = standalone) => view.rerender(tree(sessions, standaloneSessions))
}

function groupIn(section: string) {
    return within(screen.getByRole('region', { name: section })).getByTestId('session-group-row')
}

describe('group placement and agent icons', () => {
    it.each([true, false])('keeps parked groups out of current work with section pinning %s', pinInProgress => {
        localStorage.setItem('hapi-pin-in-progress-sessions', String(pinInProgress))
        mount([chat('worker'), chat('question', { thinking: false, pendingRequestKinds: ['input'] })], [], true)
        expect(screen.queryByRole('region', { name: 'Working sessions' })).toBeNull()
        expect(screen.queryByRole('region', { name: 'Active sessions' })).toBeNull()
        const parked = screen.getByRole('region', { name: 'Parked groups' })
        fireEvent.click(within(parked).getByRole('button', { name: /Parked groups/ }))
        expect(within(parked).getByTestId('session-group-row')).toBeVisible()
        expect(within(parked).getByText('2 chats')).toBeVisible()
        expect(within(parked).getByText('1 working')).toBeVisible()
        fireEvent.click(screen.getByRole('button', { name: /^Search sessions/ }))
        fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'worker' } })
        expect(screen.getByRole('tab', { name: 'Chats (1)' })).toHaveAttribute('aria-selected', 'true')
        expect(screen.getAllByTestId('session-group-row')).toHaveLength(1)
        expect(within(parked).getByTestId('session-group-row')).toBeVisible()
        fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'no match' } })
        expect(screen.queryByTestId('session-group-row')).toBeNull()
    })

    it('keeps Working before Active for groups and standalone sessions', () => {
        localStorage.setItem('hapi.sessionLastSeen.v1', JSON.stringify({ worker: 2000 }))
        mount([chat('worker')], [chat('needs-reading', { thinking: false })])
        expect(screen.getAllByRole('region').map(region => region.getAttribute('aria-label')))
            .toEqual(['Working sessions', 'Active sessions'])
    })

    it('defers unread work until completion without advancing read history', () => {
        const sessions = [chat('one'), chat('two', { metadata: { path: '/work', flavor: 'opencode' } }), chat('three')]
        const update = mount(sessions)
        expect(groupIn('Working sessions')).toHaveTextContent('3 working')
        expect(within(groupIn('Working sessions')).queryByLabelText(/unread/)).toBeNull()
        expect(within(groupIn('Working sessions')).getByRole('img', { name: 'codex, opencode' })).toBeVisible()
        expect(localStorage.getItem('hapi.sessionLastSeen.v1')).toBeNull()
        update(sessions.map(s => s.id === 'one' ? { ...s, thinking: false } : s))
        expect(within(groupIn('Active sessions')).getByLabelText('1 unread chats')).toBeVisible()
        act(() => markSessionSeen('one', 2000))
        expect(groupIn('Working sessions')).toBeVisible()
        update(sessions.map(s => ({ ...s, thinking: false })))
        expect(within(groupIn('Active sessions')).getByLabelText('2 unread chats')).toBeVisible()
    })

    it('keeps a read unanswered question in Active even while other agents work', () => {
        const sessions = [chat('worker'), chat('question', { thinking: false, pendingRequestsCount: 1, pendingRequestKinds: ['input'] })]
        const update = mount(sessions)
        act(() => { markSessionSeen('worker', 2000); markSessionSeen('question', 2000) })
        expect(within(groupIn('Active sessions')).getByLabelText('1 need you')).toBeVisible()
        update([sessions[0], { ...sessions[1], pendingRequestsCount: 0, pendingRequestKinds: [] }])
        expect(groupIn('Working sessions')).toBeVisible()
    })

    it('keeps groups and standalone chats Active after the last working agent finishes', () => {
        const grouped = chat('grouped-worker', { metadata: { path: '/work', name: 'Grouped worker', lifecycleState: 'running', flavor: 'codex' } })
        const standalone = chat('standalone', { thinking: false, metadata: { path: '/work', name: 'Standalone chat', lifecycleState: 'running', flavor: 'codex' } })
        localStorage.setItem('hapi.sessionLastSeen.v1', JSON.stringify({ 'grouped-worker': 2000, standalone: 2000 }))
        const update = mount([grouped], [standalone])
        expect(groupIn('Working sessions')).toBeVisible()
        const assertReady = () => {
            const active = screen.getByRole('region', { name: 'Active sessions' })
            expect(within(active).getByTestId('session-group-row')).toBeVisible()
            expect(within(active).getByRole('button', { name: /Standalone chat/ })).toBeVisible()
            expect(screen.queryByRole('region', { name: 'Working sessions' })).toBeNull()
            expect(screen.queryByRole('region', { name: 'Idle (keepalive only)' })).toBeNull()
            expect(within(active).queryByLabelText('Agent working')).toBeNull()
        }
        update([{ ...grouped, thinking: false }], [standalone])
        assertReady()
        // Unrelated work appearing or disappearing cannot change this group's section.
        update([{ ...grouped, thinking: false }], [{ ...standalone, thinking: true }])
        expect(groupIn('Active sessions')).toBeVisible()
        update([{ ...grouped, thinking: false }], [standalone])
        assertReady()
    })

    it.each(['idle', 'parked'] as const)('reserves Idle for %s lifecycle and lets a ready chat keep its group Active', (lifecycleState) => {
        const idle = chat('idle', { thinking: false, active: lifecycleState === 'idle',
            metadata: { path: '/work', name: 'Idle chat', lifecycleState, flavor: 'codex' } })
        const ready = chat('ready', { thinking: false, metadata: { path: '/work', name: 'Ready chat', lifecycleState: 'running', flavor: 'codex' } })
        localStorage.setItem('hapi.sessionLastSeen.v1', JSON.stringify({ idle: 2000, ready: 2000, 'standalone-idle': 2000 }))
        const standaloneIdle = { ...idle, id: 'standalone-idle' }
        const update = mount([idle, ready], [standaloneIdle])
        expect(groupIn('Active sessions')).toBeVisible()
        expect(within(screen.getByRole('region', { name: 'Idle (keepalive only)' })).getByRole('button', { name: /Idle chat/ })).toBeVisible()
        update([idle, { ...ready, active: false }], [standaloneIdle])
        expect(groupIn('Idle (keepalive only)')).toBeVisible()
        expect(screen.queryByRole('region', { name: 'Working sessions' })).toBeNull()
    })

    it('keeps quiet groups in Active, deduplicates logos and limits the composite icon', () => {
        const sessions = [chat('one', { thinking: false }), chat('two', { thinking: false }),
            chat('three', { thinking: false, metadata: { path: '/work', flavor: 'opencode' } }),
            chat('four', { thinking: false, metadata: { path: '/work', flavor: 'claude' } })]
        localStorage.setItem('hapi.sessionLastSeen.v1', JSON.stringify(Object.fromEntries(sessions.map(s => [s.id, 2000]))))
        const update = mount(sessions)
        const row = groupIn('Active sessions')
        expect(within(row).getByRole('img', { name: 'claude, codex, opencode' })).toHaveTextContent('+1')
        update(sessions.map(s => ({ ...s, metadata: { ...s.metadata!, flavor: 'codex' } })))
        expect(within(groupIn('Active sessions')).getByRole('img', { name: 'codex' })).toBeVisible()
        expect(screen.queryByText('+1')).toBeNull()
    })
})


it('keeps a bulk-action failure visible when session updates move the row into another section', async () => {
    localStorage.setItem('hapi.sessionLastSeen.v1', JSON.stringify({ working: 2000, quiet: 2000 }))
    const working = chat('working')
    const quiet = chat('quiet', { thinking: false })
    const group: SessionGroup = { id: 'hapi', name: 'HAPI', parked: false, closed: false, version: 1, updatedAt: 1000,
        members: [{ sessionId: working.id, pinned: true }, { sessionId: quiet.id, pinned: false }] }
    let finish!: (value: unknown) => void
    const changeGroupLifecycle = vi.fn(() => new Promise(resolve => { finish = resolve }))
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    const ui = (current: SessionGroup, sessions: SessionSummary[]) => <QueryClientProvider client={client}><ToastProvider><I18nProvider><AppContextTestProvider>
        <SessionList sessions={[]} groupedSessions={sessions} sessionGroups={[current]} hasGroupRows onSelect={vi.fn()}
            onSelectGroup={vi.fn()} onNewSession={vi.fn()} onRefresh={vi.fn()} isLoading={false}
            api={{ changeGroupLifecycle } as unknown as ApiClient} renderHeader={false} />
    </AppContextTestProvider></I18nProvider></ToastProvider></QueryClientProvider>
    const view = render(ui(group, [working, quiet]))
    fireEvent.contextMenu(groupIn('Working sessions'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Close group' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close group' }))
    await waitFor(() => expect(changeGroupLifecycle).toHaveBeenCalled())
    const partiallyClosed = { ...group, closed: true, version: 2 }
    view.rerender(ui(partiallyClosed, [{ ...working, active: false, metadata: { ...working.metadata!, lifecycleState: 'archived' } }, quiet]))
    expect(groupIn('Active sessions')).toHaveTextContent('Close incomplete')
    await act(async () => finish({ group: partiallyClosed, failures: [{ sessionId: quiet.id, message: 'Runner offline' }] }))
    await waitFor(() => expect(screen.getByRole('dialog')).toHaveTextContent('quiet: Runner offline'))
})
