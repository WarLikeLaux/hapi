import { act, cleanup, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
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

function mount(chats: SessionSummary[], standalone: SessionSummary[] = []) {
    const group: SessionGroup = { id: 'hapi', name: 'HAPI', version: 1, updatedAt: 1000,
        members: chats.map(session => ({ sessionId: session.id, pinned: false })) }
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const tree = (sessions: SessionSummary[]) => <QueryClientProvider client={client}><ToastProvider><I18nProvider><AppContextTestProvider>
        <SessionList sessions={standalone} groupedSessions={sessions} sessionGroups={[group]} hasGroupRows
            onSelect={vi.fn()} onSelectGroup={vi.fn()} onNewSession={vi.fn()} onRefresh={vi.fn()} isLoading={false} api={null} renderHeader={false} />
    </AppContextTestProvider></I18nProvider></ToastProvider></QueryClientProvider>
    const view = render(tree(chats))
    return (sessions: SessionSummary[]) => view.rerender(tree(sessions))
}

function groupIn(section: string) {
    return within(screen.getByRole('region', { name: section })).getByTestId('session-group-row')
}

describe('group placement and agent icons', () => {
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

    it('places quiet groups in Idle, deduplicates logos and limits the composite icon', () => {
        const sessions = [chat('one', { thinking: false }), chat('two', { thinking: false }),
            chat('three', { thinking: false, metadata: { path: '/work', flavor: 'opencode' } }),
            chat('four', { thinking: false, metadata: { path: '/work', flavor: 'claude' } })]
        localStorage.setItem('hapi.sessionLastSeen.v1', JSON.stringify(Object.fromEntries(sessions.map(s => [s.id, 2000]))))
        const update = mount(sessions)
        const row = groupIn('Idle (keepalive only)')
        expect(within(row).getByRole('img', { name: 'claude, codex, opencode' })).toHaveTextContent('+1')
        update(sessions.map(s => ({ ...s, metadata: { ...s.metadata!, flavor: 'codex' } })))
        expect(within(groupIn('Idle (keepalive only)')).getByRole('img', { name: 'codex' })).toBeVisible()
        expect(screen.queryByText('+1')).toBeNull()
    })
})
