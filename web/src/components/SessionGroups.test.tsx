import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ToastProvider } from '@/lib/toast-context'
import type { ApiClient } from '@/api/client'
import type { ReactElement } from 'react'
import { act, cleanup, fireEvent, render as renderComponent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import type { SessionGroup } from '@hapi/protocol'
import type { SessionSummary } from '@/types/api'
import { I18nProvider } from '@/lib/i18n-context'
import { getSessionLastSeenAt, markSessionUnread } from '@/lib/sessionLastSeen'
import { useSelectedSessionSeen } from '@/hooks/useSelectedSessionSeen'
import { SessionGroupWorkspace } from './SessionGroups'

function render(ui: ReactElement) {
    const client = new QueryClient()
    return renderComponent(ui, { wrapper: ({ children }) => <QueryClientProvider client={client}><ToastProvider>{children}</ToastProvider></QueryClientProvider> })
}

const group: SessionGroup = { id: 'group', name: 'HAPI', closed: false, parked: false, version: 1, updatedAt: 1,
    members: [{ sessionId: 'first', pinned: true }, { sessionId: 'worker', pinned: false }] }
const chats = (thinking: boolean, extra: Partial<SessionSummary> = {}): SessionSummary[] => ['first', 'worker'].map(id => ({
    id, active: true, thinking: id === 'worker' && thinking, lastAgentMessageAt: 2000, updatedAt: 2000,
    metadata: { path: '/work', name: id, flavor: 'codex' }, metadataVersion: 1, agentStateVersion: 1,
    activeAt: 1, todosUpdatedAt: 0, todoProgress: null, pendingRequestsCount: 0, pendingRequestKinds: [], pendingRequests: [],
    backgroundTaskCount: 0, futureScheduledMessageCount: 0, nextScheduledAt: null, model: null, effort: null,
    ...(id === 'worker' ? extra : {}),
}))
function Workspace({ sessions, workspaceGroup = group }: { sessions: SessionSummary[]; workspaceGroup?: SessionGroup }) {
    const [selected, select] = useState('first')
    useSelectedSessionSeen(selected, sessions.find(s => s.id === selected)?.lastAgentMessageAt)
    return <I18nProvider><SessionGroupWorkspace group={workspaceGroup} groups={[workspaceGroup]} sessions={sessions} selectedSessionId={selected}
        onSelect={select} onBack={vi.fn()} onNew={vi.fn()} onUpdate={vi.fn()} pending={false} /></I18nProvider>
}
const worker = () => screen.getByRole('tab', { name: /^worker/ })
beforeEach(() => {
    localStorage.clear()
    localStorage.setItem('hapi.sessionLastSeen.v1', JSON.stringify({ first: 2000, worker: 1000 }))
    Element.prototype.scrollIntoView = vi.fn()
})
afterEach(cleanup)

describe('group tab attention', () => {
    it('preserves unread history across work, completion and page reopening until the tab is opened', () => {
        const view = render(<Workspace sessions={chats(true)} />)
        expect(within(worker()).queryByLabelText('New activity')).toBeNull()
        expect(getSessionLastSeenAt('worker')).toBe(1000)
        view.unmount()
        const reopened = render(<Workspace sessions={chats(true)} />)
        expect(within(worker()).queryByLabelText('New activity')).toBeNull()
        reopened.rerender(<Workspace sessions={chats(false)} />)
        expect(within(worker()).getAllByLabelText('New activity').length).toBeGreaterThan(0)
        reopened.unmount()
        render(<Workspace sessions={chats(false)} />)
        expect(within(worker()).getAllByLabelText('New activity').length).toBeGreaterThan(0)
        fireEvent.click(worker())
        expect(getSessionLastSeenAt('worker')).toBe(2000)
        expect(within(worker()).queryByLabelText('New activity')).toBeNull()
    })

    it('keeps an open tab read through work and completion, while preserving an explicit mark unread', () => {
        const view = render(<Workspace sessions={chats(true)} />)
        fireEvent.click(worker())
        view.rerender(<Workspace sessions={chats(false, { lastAgentMessageAt: 3000 })} />)
        expect(getSessionLastSeenAt('worker')).toBe(3000)
        expect(within(worker()).queryByLabelText('New activity')).toBeNull()
        act(() => markSessionUnread('worker', 3000))
        expect(within(worker()).getAllByLabelText('New activity').length).toBeGreaterThan(0)
    })

    it.each([
        ['input', 0, 'Waiting for answer'], ['input', 1, 'Question'], ['permission', 0, 'Permission required'],
    ] as const)('keeps %s attention visible during work and in the selected tab', (kind, asyncCount, label) => {
        render(<Workspace sessions={chats(kind !== 'permission', { pendingRequestKinds: [kind], pendingRequestsCount: 1, pendingAsyncQuestionsCount: asyncCount })} />)
        expect(within(worker()).getByLabelText(label)).toBeVisible()
        fireEvent.click(worker())
        expect(within(worker()).getByLabelText(label)).toBeVisible()
    })
})

describe('group chat switcher', () => {
    afterEach(() => vi.restoreAllMocks())

    it('reorders the intended visible chats when an archived member remains in stored manual order', () => {
        const workspaceGroup = { ...group, members: [
            { sessionId: 'closed', pinned: false }, { sessionId: 'first', pinned: false }, { sessionId: 'worker', pinned: false },
        ] }
        const onUpdate = vi.fn().mockResolvedValue(undefined)
        render(<I18nProvider><SessionGroupWorkspace group={workspaceGroup} groups={[workspaceGroup]}
            sessions={[...chats(false), { ...chats(false)[0], id: 'closed', metadata: { path: '/work', lifecycleState: 'archived' } }]}
            selectedSessionId="worker" onSelect={vi.fn()} onBack={vi.fn()} onNew={vi.fn()} onUpdate={onUpdate} pending={false} /></I18nProvider>)
        fireEvent.click(screen.getByRole('button', { name: 'Manage' }))
        const row = screen.getAllByTestId('group-member').find(row => within(row).queryByTitle('worker'))!
        fireEvent.click(within(row).getByRole('button', { name: 'Move tab left' }))
        expect(onUpdate).toHaveBeenCalledWith(workspaceGroup, expect.objectContaining({ members: [
            { sessionId: 'worker', pinned: false }, { sessionId: 'first', pinned: false },
        ] }))
    })

    it('keeps the active chat while priority changes and uses the same order for menu and keyboard', async () => {
        const workspaceGroup = { ...group, members: [...group.members, { sessionId: 'other', pinned: false }] }
        const sessions = [...chats(false), { ...chats(false)[1], id: 'other', metadata: { path: '/work', name: 'other' } }]
        const view = render(<Workspace sessions={sessions} workspaceGroup={workspaceGroup} />)
        fireEvent.click(worker())
        view.rerender(<Workspace sessions={sessions.map(session => session.id === 'other'
            ? { ...session, pendingRequestsCount: 1, pendingRequestKinds: ['input'] } : session)} workspaceGroup={workspaceGroup} />)
        expect(screen.getAllByRole('tab').map(tab => tab.textContent)).toEqual(['first', 'other', 'worker'])
        expect(worker()).toHaveAttribute('aria-selected', 'true')
        fireEvent.keyDown(worker(), { key: 'ArrowLeft' })
        expect(screen.getByRole('tab', { name: /^other/ })).toHaveAttribute('aria-selected', 'true')
        fireEvent.click(screen.getByRole('button', { name: 'Switch chat' }))
        const menu = await screen.findByRole('menu')
        expect(within(menu).getAllByRole('menuitemradio').map(item => item.title)).toEqual(['first', 'other', 'worker'])
    })

    it('opens the desktop menu at the current chat and selects with keyboard navigation', async () => {
        render(<Workspace sessions={chats(true)} />)
        const trigger = screen.getByRole('button', { name: 'Switch chat' })
        fireEvent.keyDown(trigger, { key: 'ArrowDown' })
        const menu = await screen.findByRole('menu', { name: 'Switch chat' })
        const [first, second] = within(menu).getAllByRole('menuitemradio')
        expect(first).toHaveAttribute('aria-checked', 'true')
        expect(second).toHaveAttribute('aria-checked', 'false')
        expect(first).toHaveFocus()

        fireEvent.keyDown(first, { key: 'ArrowDown' })
        expect(second).toHaveFocus()
        // Moving around the menu must not change the workspace tab yet.
        expect(screen.getByRole('tab', { name: /^first/ })).toHaveAttribute('aria-selected', 'true')
        fireEvent.keyDown(second, { key: 'Home' })
        expect(first).toHaveFocus()
        fireEvent.keyDown(first, { key: 'End' })
        expect(second).toHaveFocus()
        fireEvent.click(second)

        expect(screen.queryByRole('menu')).toBeNull()
        expect(worker()).toHaveAttribute('aria-selected', 'true')
        await waitFor(() => expect(trigger).toHaveFocus())
        fireEvent.click(trigger)
        expect(await screen.findByRole('menuitemradio', { checked: true })).toHaveTextContent('worker')
        expect(screen.getByRole('menuitemradio', { checked: true })).toHaveFocus()
    })

    it('dismisses the desktop menu with Escape and restores trigger focus without changing chat', async () => {
        render(<Workspace sessions={chats(false)} />)
        const trigger = screen.getByRole('button', { name: 'Switch chat' })
        fireEvent.click(trigger)
        fireEvent.keyDown(await screen.findByRole('menuitemradio', { checked: true }), { key: 'Escape' })
        await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
        await waitFor(() => expect(trigger).toHaveFocus())
        expect(screen.getByRole('tab', { name: /^first/ })).toHaveAttribute('aria-selected', 'true')
    })

    it.each(['narrow', 'touch'])('retains native selection on a %s device', device => {
        const originalMatchMedia = window.matchMedia.bind(window)
        vi.spyOn(window, 'matchMedia').mockImplementation(query => ({
            ...originalMatchMedia(query),
            matches: device === 'narrow' ? query.includes('max-width') : query === '(pointer: coarse)',
        }))
        render(<Workspace sessions={chats(false)} />)
        const select = screen.getByRole('combobox', { name: 'Switch chat' })
        expect(screen.queryByRole('button', { name: 'Switch chat' })).toBeNull()
        fireEvent.change(select, { target: { value: 'worker' } })
        expect(worker()).toHaveAttribute('aria-selected', 'true')
        expect(screen.queryByRole('menu')).toBeNull()
    })
})

describe('group tab session actions', () => {
    it.each([
        { active: true, lifecycleState: 'running' },
        { active: true, lifecycleState: 'idle' },
        { active: false, lifecycleState: 'idle' },
        { active: false, lifecycleState: 'parked' },
    ])('copies and stops the intended $lifecycleState tab (active=$active) without switching chat', async ({ active, lifecycleState }) => {
        const writeText = vi.fn().mockResolvedValue(undefined)
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
        const archiveSession = vi.fn().mockResolvedValue(undefined)
        const select = vi.fn()
        render(<I18nProvider><SessionGroupWorkspace group={group} groups={[group]} sessions={chats(false, { active, metadata: { path: "/work", name: "worker", flavor: "codex", lifecycleState } })}
            api={{ archiveSession } as unknown as ApiClient} selectedSessionId="first" onSelect={select}
            onBack={vi.fn()} onNew={vi.fn()} onUpdate={vi.fn()} pending={false} /></I18nProvider>)
        fireEvent.contextMenu(worker(), { clientX: 300, clientY: 40 })
        fireEvent.click(await screen.findByRole('menuitem', { name: 'Copy reference' }))
        await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining('See session "worker" (/sessions/worker)')))
        expect(select).not.toHaveBeenCalled()
        expect(worker()).toHaveFocus()
        expect(screen.queryByRole('menu')).toBeNull()
        fireEvent.keyDown(worker(), { key: 'F10', shiftKey: true })
        fireEvent.click(await screen.findByRole('menuitem', { name: 'Stop session' }))
        expect(archiveSession).not.toHaveBeenCalled()
        const dialog = await screen.findByRole('dialog')
        expect(within(dialog).getByText(/worker/)).toBeVisible()
        fireEvent.click(within(dialog).getByRole('button', { name: 'Stop session' }))
        await waitFor(() => expect(archiveSession).toHaveBeenCalledWith('worker'))
        expect(select).not.toHaveBeenCalled()
    })

    it('keeps cursor reopen unavailable when the inactive tab has no chat store', async () => {
        const sessions = chats(false).map(s => s.id === 'worker' ? { ...s, active: false,
            metadata: { ...s.metadata!, flavor: 'cursor' as const, agentSessionId: 'native-worker' } } : s)
        const getCursorChatStoreStatus = vi.fn().mockResolvedValue({ onDisk: false })
        render(<I18nProvider><SessionGroupWorkspace group={group} groups={[group]} sessions={sessions}
            api={{ getCursorChatStoreStatus } as unknown as ApiClient} selectedSessionId="first" onSelect={vi.fn()}
            onBack={vi.fn()} onNew={vi.fn()} onUpdate={vi.fn()} pending={false} /></I18nProvider>)
        fireEvent.contextMenu(worker())
        await waitFor(() => expect(getCursorChatStoreStatus).toHaveBeenCalledWith('worker'))
        await waitFor(() => expect(screen.getByRole('tooltip')).toHaveTextContent('Cursor chat data is no longer available on the recorded machine.'))
        expect(screen.getByRole('menuitem', { name: 'Reopen' })).toHaveAttribute('aria-disabled', 'true')
        expect(screen.queryByRole('menuitem', { name: 'Restart session' })).toBeNull()
    })
})

describe('parked group workspace', () => {
    it('restores the entire group while retaining its tabs and pin, and disables restore while saving', async () => {
        const onUpdate = vi.fn(async () => true)
        const ui = (pending: boolean) => <I18nProvider><SessionGroupWorkspace group={{ ...group, parked: true }} groups={[group]}
            sessions={chats(true)} selectedSessionId="first" onSelect={vi.fn()} onNew={vi.fn()} onBack={vi.fn()} onUpdate={onUpdate} pending={pending} /></I18nProvider>
        const view = render(ui(false))
        expect(screen.getByText('This group is parked. Chats stay open and agents keep running.')).toBeVisible()
        expect(screen.getAllByRole('tab').map(tab => tab.title)).toEqual(['first · codex', 'worker · codex'])
        fireEvent.click(screen.getByRole('button', { name: 'Restore group' }))
        await waitFor(() => expect(onUpdate).toHaveBeenCalledWith({ ...group, parked: true }, { ...group, parked: false }))
        view.rerender(ui(true))
        expect(screen.getByRole('button', { name: 'Restore group' })).toBeDisabled()
    })
})
