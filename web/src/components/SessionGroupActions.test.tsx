import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionGroup } from '@hapi/protocol'
import type { ApiClient } from '@/api/client'
import type { SessionSummary } from '@/types/api'
import { I18nProvider } from '@/lib/i18n-context'
import { SessionGroupRows } from './SessionGroups'

const group: SessionGroup = { id: 'workspace', name: 'HAPI', closed: false, parked: false, version: 3, updatedAt: 1,
    members: [{ sessionId: 'coordinator', pinned: true }, { sessionId: 'worker', pinned: false }] }
const chats = group.members.map(member => ({ id: member.sessionId, active: true, thinking: false,
    metadata: { path: '/work', name: member.sessionId, flavor: 'codex', lifecycleState: 'running' },
})) as SessionSummary[]

function mount(overrides: Partial<SessionGroup> = {}, failures: { sessionId: string; message: string }[] = [], sessions = chats) {
    const current = { ...group, ...overrides }
    const onOpen = vi.fn()
    const onHidden = vi.fn()
    const onNew = vi.fn()
    const updateGroup = vi.fn(async (_id: string, patch: object) => ({ group: { ...current, ...patch } }))
    const changeGroupLifecycle = vi.fn(async (_id: string, _version: number, action: string) => ({ group: { ...current, closed: action === 'close', parked: action === 'park' }, failures }))
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    render(<QueryClientProvider client={client}><I18nProvider><SessionGroupRows groups={[current]} sessions={sessions}
        search="" api={{ updateGroup, changeGroupLifecycle } as unknown as ApiClient} onOpen={onOpen} onHidden={onHidden} onNew={onNew} /></I18nProvider></QueryClientProvider>)
    return { row: screen.getByTestId('session-group-row'), onOpen, onHidden, updateGroup, changeGroupLifecycle }
}

beforeEach(() => { Element.prototype.scrollIntoView = vi.fn() })

afterEach(() => { cleanup(); vi.useRealTimers(); localStorage.clear() })

describe('group context menu', () => {
    it('opens by right-click without navigating and parks the whole group from its menu', async () => {
        const f = mount()
        fireEvent.contextMenu(f.row, { clientX: 100, clientY: 100 })
        expect(f.onOpen).not.toHaveBeenCalled()
        expect(screen.getByRole('menu', { name: 'Group actions' })).toBeVisible()
        fireEvent.click(screen.getByRole('menuitem', { name: 'Park group' }))
        await waitFor(() => expect(f.onHidden).toHaveBeenCalled())
        expect(f.changeGroupLifecycle).toHaveBeenCalledWith(group.id, group.version, 'park')
        expect(f.updateGroup).not.toHaveBeenCalled()
    })

    it('supports keyboard navigation, restoring a parked group and ordinary row activation', async () => {
        const f = mount({ parked: true })
        fireEvent.keyDown(f.row, { key: 'F10', shiftKey: true })
        expect(screen.queryByRole('menuitem', { name: 'Park group' })).toBeNull()
        const restore = screen.getByRole('menuitem', { name: 'Restore group' })
        fireEvent.keyDown(screen.getByRole('menu'), { key: 'End' })
        expect(screen.getByRole('menuitem', { name: 'Close group' })).toHaveFocus()
        fireEvent.click(restore)
        await waitFor(() => expect(f.changeGroupLifecycle).toHaveBeenCalledWith(group.id, group.version, 'reopen'))
        fireEvent.click(f.row)
        expect(f.onOpen).toHaveBeenCalledWith({ ...group, parked: true })
    })

    it.each([
        { thinking: true }, { backgroundTaskCount: 1 }, { pendingRequestsCount: 1 }, { pendingAsyncQuestionsCount: 1 },
    ])('disables group parking with an explanation when a chat is busy: %j', patch => {
        const f = mount({}, [], chats.map((chat, index) => index ? { ...chat, ...patch } : chat))
        fireEvent.contextMenu(f.row)
        const park = screen.getByRole('menuitem', { name: /^Park group/ })
        expect(park).toBeDisabled()
        expect(park).toHaveTextContent('Wait until all agents finish')
        fireEvent.click(park)
        expect(f.changeGroupLifecycle).not.toHaveBeenCalled()
    })

    it('opens on a long touch and suppresses the following compatibility click', async () => {
        vi.useFakeTimers()
        const f = mount()
        fireEvent.touchStart(f.row, { touches: [{ clientX: 80, clientY: 120 }] })
        act(() => vi.advanceTimersByTime(510))
        fireEvent.touchEnd(f.row)
        fireEvent.click(f.row, { detail: 1 })
        expect(screen.getByRole('menu')).toBeVisible()
        expect(f.onOpen).not.toHaveBeenCalled()
    })

    it('requires confirmation to close and reports failed chats without hiding the group', async () => {
        const f = mount({}, [{ sessionId: 'worker', message: 'Runner offline' }])
        fireEvent.contextMenu(f.row)
        fireEvent.click(screen.getByRole('menuitem', { name: 'Close group' }))
        expect(f.changeGroupLifecycle).not.toHaveBeenCalled()
        const dialog = screen.getByRole('dialog')
        expect(dialog).toHaveTextContent('Stop all 2 chats in "HAPI"?')
        fireEvent.click(within(dialog).getByRole('button', { name: 'Close group' }))
        await waitFor(() => expect(dialog).toHaveTextContent('worker: Runner offline'))
        expect(f.changeGroupLifecycle).toHaveBeenCalledWith(group.id, group.version, 'close')
        expect(f.onHidden).not.toHaveBeenCalled()
    })

    it('opens all chats of a closed group and keeps its history independently accessible', async () => {
        const f = mount({ closed: true })
        fireEvent.contextMenu(f.row)
        expect(screen.getByRole('menuitem', { name: 'View history' })).toBeVisible()
        expect(screen.queryByRole('menuitem', { name: 'Park group' })).toBeNull()
        fireEvent.click(screen.getByRole('menuitem', { name: 'Open group' }))
        await waitFor(() => expect(f.changeGroupLifecycle).toHaveBeenCalledWith(group.id, group.version, 'reopen'))
        expect(f.onOpen).toHaveBeenCalledWith(group)
    })
})


it('renames a group from the context menu while preserving its composition', async () => {
    const f = mount()
    fireEvent.contextMenu(f.row)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename group' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Group name' }), { target: { value: 'Release planning' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Rename' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(f.updateGroup).toHaveBeenCalledWith(group.id, { ...group, name: 'Release planning' })
})
