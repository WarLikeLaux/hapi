import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ApiClient } from '@/api/client'
import type { SessionGroup } from '@hapi/protocol'
import type { ExternalConversation } from '@hapi/protocol/messengers'
import type { SessionSummary } from '@/types/api'
import { I18nProvider } from '@/lib/i18n-context'
import { AppContextTestProvider } from '@/test/app-context'
import { ToastProvider } from '@/lib/toast-context'
import { markSessionSeen } from '@/lib/sessionLastSeen'
import { SessionList } from './SessionList'

vi.mock('@tanstack/react-router', async (importOriginal) => ({
    ...await importOriginal<typeof import('@tanstack/react-router')>(),
    useNavigate: () => vi.fn(),
    useParams: () => ({}),
}))

afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks() })

function chat(id: string, overrides: Partial<SessionSummary> = {}): SessionSummary {
    return { id, active: true, thinking: true, activeAt: 1000, updatedAt: 2000, lastAgentMessageAt: 2000,
        metadata: { path: '/work', name: id, flavor: 'codex' }, metadataVersion: 1, agentStateVersion: 1,
        todosUpdatedAt: 0, todoProgress: null, pendingRequestsCount: 0, pendingRequestKinds: [], pendingRequests: [],
        backgroundTaskCount: 0, futureScheduledMessageCount: 0, nextScheduledAt: null, model: null, effort: null, ...overrides }
}

function mount(chats: SessionSummary[], standalone: SessionSummary[] = [], parked = false, extraGroups: SessionGroup[] = [], conversations: ExternalConversation[] = []) {
    const group: SessionGroup = { id: 'hapi', name: 'HAPI', closed: false, parked, version: 1, updatedAt: 1000,
        members: chats.filter(session => !extraGroups.some(group => group.members.some(member => member.sessionId === session.id))).map(session => ({ sessionId: session.id, pinned: false })) }
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const tree = (sessions: SessionSummary[], standaloneSessions = standalone, currentGroup = group) => <QueryClientProvider client={client}><ToastProvider><I18nProvider><AppContextTestProvider>
        <SessionList sessions={standaloneSessions} groupedSessions={sessions} sessionGroups={[currentGroup, ...extraGroups]} hasGroupRows
            onSelect={vi.fn()} onSelectGroup={vi.fn()} onNewSession={vi.fn()} onRefresh={vi.fn()} isLoading={false} api={conversations.length ? { getExternalConversations: async () => ({ conversations }) } as ApiClient : null} renderHeader={false} />
    </AppContextTestProvider></I18nProvider></ToastProvider></QueryClientProvider>
    const view = render(tree(chats))
    return (sessions: SessionSummary[], standaloneSessions = standalone, currentGroup = group) => view.rerender(tree(sessions, standaloneSessions, currentGroup))
}

function groupIn(section: string) {
    return within(screen.getByRole('region', { name: section })).getByTestId('session-group-row')
}

describe('group placement and agent icons', () => {
    it('interleaves groups by displayed activity and moves them only for new conversation activity', async () => {
        const now = Date.now()
        vi.spyOn(Date, 'now').mockReturnValue(now)
        const minute = 60_000
        const grouped = chat('grouped', { thinking: false, createdAt: now - 24 * 60 * minute,
            lastAgentMessageAt: now - 180 * minute, updatedAt: now })
        const older = chat('older-group', { ...grouped, id: 'older-group', lastAgentMessageAt: now - 360 * minute })
        const extra: SessionGroup = { id: 'max', name: 'MAX Business', closed: false, parked: false,
            version: 1, updatedAt: now, members: [{ sessionId: older.id, pinned: true }] }
        const standalone = [chat('Recent chat', { thinking: false, lastAgentMessageAt: now - 7 * minute }),
            chat('Old chat', { thinking: false, lastAgentMessageAt: now - 240 * minute }),
            chat('Pinned chat', { thinking: false, globalPinned: true, lastAgentMessageAt: now - 600 * minute })]
        const conversation: ExternalConversation = { id: 'messenger', provider: 'telegram', remoteId: '1',
            title: 'Messenger chat', customTitle: null, kind: 'direct', selected: true, lastMessageAt: now - 2 * minute,
            lastMessagePreview: 'A fresh message', lastMessageDirection: 'incoming', unreadCount: 1, avatarDataUrl: null }
        const update = mount([grouped, older], standalone, false, [extra], [conversation])
        await screen.findByRole('button', { name: /Messenger chat/ })
        const rows = () => Array.from(screen.getByRole('region', { name: 'Active sessions' })
            .querySelectorAll('.session-list-item')).map(row => row.textContent)
        const assertOrder = (names: string[]) => {
            expect(rows()).toHaveLength(names.length)
            names.forEach((name, index) => expect(rows()[index]).toContain(name))
        }
        assertOrder(['Messenger chat', 'Recent chat', 'HAPI', 'Old chat', 'MAX Business'])
        expect(screen.getAllByTestId('session-group-row')[0]).toHaveTextContent('3h ago')
        expect(screen.getAllByTestId('session-group-row')[1]).toHaveTextContent('6h ago')
        expect(screen.getByRole('button', { name: /Pinned chat/ })).toBeVisible()
        update([{ ...grouped, updatedAt: now + minute, metadataVersion: 2 }, older], [...standalone].reverse(),
            { id: 'hapi', name: 'HAPI', closed: false, parked: false, version: 2, updatedAt: now + minute,
                members: [{ sessionId: grouped.id, pinned: true }] })
        assertOrder(['Messenger chat', 'Recent chat', 'HAPI', 'Old chat', 'MAX Business'])
        expect(screen.getAllByTestId('session-group-row')[0]).toHaveTextContent('3h ago')
        update([{ ...grouped, lastAgentMessageAt: now }, older])
        assertOrder(['HAPI', 'Messenger chat', 'Recent chat', 'Old chat', 'MAX Business'])
        expect(screen.getAllByTestId('session-group-row')[0]).toHaveTextContent('just now')
        update([{ ...grouped, lastAgentMessageAt: now }, older], standalone.map(s => s.id === 'Recent chat'
            ? { ...s, lastAgentMessageAt: now + minute } : s))
        assertOrder(['Recent chat', 'HAPI', 'Messenger chat', 'Old chat', 'MAX Business'])
    })

    it.each([
        { section: 'Working sessions', thinking: true, active: true, lifecycleState: 'running', userClock: true },
        { section: 'Idle (keepalive only)', thinking: false, active: true, lifecycleState: 'idle', userClock: false },
        { section: 'Closed sessions', thinking: false, active: false, lifecycleState: 'archived', userClock: false },
    ])('shares the $section activity clock and preserves its section', ({ section, thinking, active, lifecycleState, userClock }) => {
        const now = Date.now()
        vi.spyOn(Date, 'now').mockReturnValue(now)
        const hour = 3_600_000
        const metadata = (name: string) => ({ path: '/work', name, flavor: 'codex' as const, lifecycleState })
        const grouped = chat('grouped', { thinking, active, metadata: metadata('Grouped'), createdAt: now - 24 * hour,
            lastUserMessageAt: now - 3 * hour, lastAgentMessageAt: now - 2 * hour, updatedAt: now })
        const standalone = [chat('Recent', { thinking, active, metadata: metadata('Recent'),
            lastUserMessageAt: now - hour, lastAgentMessageAt: now - hour }),
            chat('Old', { thinking, active, metadata: metadata('Old'),
                lastUserMessageAt: now - 4 * hour, lastAgentMessageAt: now - 4 * hour })]
        localStorage.setItem('hapi.sessionLastSeen.v1', JSON.stringify({ grouped: now, Recent: now, Old: now }))
        const update = mount([grouped], standalone)
        if (!active) update([grouped], standalone, { id: 'hapi', name: 'HAPI', closed: true, parked: false,
            version: 2, updatedAt: now, members: [{ sessionId: grouped.id, pinned: false }] })
        if (!active) fireEvent.click(screen.getByRole('button', { name: /Toggle recent history/i }))
        const container = active ? screen.getByRole('region', { name: section })
            : screen.getByRole('button', { name: /Toggle recent history/i }).parentElement!
        const rows = Array.from(container.querySelectorAll('.session-list-item'))
        expect(rows).toHaveLength(3)
        expect(rows[0]).toHaveTextContent('Recent')
        expect(rows[1]).toHaveTextContent('HAPI')
        expect(rows[1]).toHaveTextContent(userClock ? '3h ago' : '2h ago')
        expect(rows[2]).toHaveTextContent('Old')
    })

    it('paginates the combined Closed list without letting older groups bypass newer chats', () => {
        const now = Date.now()
        const standalone = Array.from({ length: 6 }, (_, index) => chat(`Closed ${index + 1}`, {
            active: false, thinking: false, lastAgentMessageAt: now - (index + 1) * 60_000,
            metadata: { path: '/work', name: `Closed ${index + 1}`, lifecycleState: 'archived' },
        }))
        const grouped = chat('grouped', { active: false, thinking: false, lastAgentMessageAt: now - 10 * 60_000,
            metadata: { path: '/work', lifecycleState: 'archived' } })
        const update = mount([grouped], standalone)
        update([grouped], standalone, { id: 'hapi', name: 'HAPI', closed: true, parked: false,
            version: 2, updatedAt: now, members: [{ sessionId: grouped.id, pinned: true }] })
        const toggle = screen.getByRole('button', { name: 'Toggle recent history' })
        fireEvent.click(toggle)
        const recent = within(toggle.parentElement!)
        expect(recent.queryByTestId('session-group-row')).toBeNull()
        expect(toggle.parentElement!.querySelectorAll('.session-list-item')).toHaveLength(5)
        fireEvent.click(recent.getByRole('button', { name: 'Expand 2' }))
        const rows = Array.from(toggle.parentElement!.querySelectorAll('.session-list-item'))
        expect(rows).toHaveLength(7)
        expect(rows[5]).toHaveTextContent('Closed 6')
        expect(rows[6]).toHaveTextContent('HAPI')
    })

    it('keeps newly opened empty sessions first without giving empty group members a service-update clock', () => {
        const now = Date.now()
        const grouped = chat('grouped', { thinking: false, lastAgentMessageAt: 0, lastMessageAt: 0,
            hasConversationContent: false, createdAt: now - 3_600_000, updatedAt: now })
        mount([grouped], [chat('Empty', { thinking: false, hasConversationContent: false,
            lastAgentMessageAt: 0, lastMessageAt: 0, createdAt: now - 7_200_000 }),
            chat('Recent', { thinking: false, lastAgentMessageAt: now - 60_000 })])
        const rows = Array.from(screen.getByRole('region', { name: 'Active sessions' }).querySelectorAll('.session-list-item'))
        expect(rows.map(row => row.textContent)).toEqual([
            expect.stringContaining('Empty'), expect.stringContaining('Recent'), expect.stringContaining('HAPI'),
        ])
        expect(rows[2]).toHaveTextContent('1h ago')
    })

    it.each([true, false])('keeps parked groups visible alongside idle chats with section pinning %s', pinInProgress => {
        localStorage.setItem('hapi-pin-in-progress-sessions', String(pinInProgress))
        const idle = chat('standalone-idle', { thinking: false,
            metadata: { path: '/work', name: 'Idle chat', lifecycleState: 'idle' } })
        localStorage.setItem('hapi.sessionLastSeen.v1', JSON.stringify({ 'standalone-idle': 2000 }))
        mount([chat('worker'), chat('question', { thinking: false, pendingRequestKinds: ['input'] })], [idle], true)
        expect(screen.queryByRole('region', { name: 'Working sessions' })).toBeNull()
        expect(screen.queryByRole('region', { name: 'Active sessions' })).toBeNull()
        expect(screen.queryByRole('region', { name: 'Parked groups' })).toBeNull()
        const row = screen.getByTestId('session-group-row')
        expect(row).toBeVisible()
        expect(within(row).getByText('2 chats')).toBeVisible()
        expect(within(row).getByText('1 working')).toBeVisible()
        expect(within(row).getByText('Parked')).toBeVisible()
        if (pinInProgress) {
            const idleSection = screen.getByRole('region', { name: 'Idle (keepalive only)' })
            expect(within(idleSection).getByTestId('session-group-row')).toBeVisible()
            expect(within(idleSection).getByRole('button', { name: /Idle chat/ })).toBeVisible()
        }
        fireEvent.click(screen.getByRole('button', { name: /^Search sessions/ }))
        fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'worker' } })
        expect(screen.getByRole('tab', { name: 'Chats (1)' })).toHaveAttribute('aria-selected', 'true')
        expect(screen.getAllByTestId('session-group-row')).toHaveLength(1)
        expect(screen.getByTestId('session-group-row')).toBeVisible()
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
