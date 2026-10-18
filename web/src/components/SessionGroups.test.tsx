import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import type { SessionGroup } from '@hapi/protocol'
import type { SessionSummary } from '@/types/api'
import { I18nProvider } from '@/lib/i18n-context'
import { getSessionLastSeenAt, markSessionUnread } from '@/lib/sessionLastSeen'
import { useSelectedSessionSeen } from '@/hooks/useSelectedSessionSeen'
import { SessionGroupWorkspace } from './SessionGroups'

const group: SessionGroup = { id: 'group', name: 'HAPI', version: 1, updatedAt: 1,
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
