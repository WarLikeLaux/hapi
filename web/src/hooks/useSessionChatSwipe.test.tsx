import { useRef } from 'react'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionGroup } from '@hapi/protocol'
import { ApiClient } from '@/api/client'
import type { SessionSummary } from '@/types/api'
import { sessionGroupsKey } from './queries/useSessionGroups'
import { useSessionChatSwipe } from './useSessionChatSwipe'

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }))
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }))

const api = new ApiClient('test-token')
const sessions = ['first', 'second', 'third'].map(id => ({ id }) as SessionSummary)
const group: SessionGroup = {
    id: 'group', name: 'Group', version: 1, updatedAt: 1,
    // Deliberately interleaved: pinned chats appear before ordinary tabs.
    members: [
        { sessionId: 'second', pinned: false },
        { sessionId: 'first', pinned: true },
        { sessionId: 'missing', pinned: false },
        { sessionId: 'third', pinned: false },
    ],
}

afterEach(() => { cleanup(); vi.clearAllMocks(); vi.restoreAllMocks() })

function mount(sessionId: string, groups: SessionGroup[] | null = [group], path: string | undefined = '/work') {
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } })
    if (groups) client.setQueryData(sessionGroupsKey, { groups })
    vi.spyOn(api, 'getGroups').mockImplementation(() => new Promise(() => {}))
    function Chat() {
        const ref = useRef<HTMLDivElement>(null)
        useSessionChatSwipe(ref, { api, sessionId, path, sessions })
        return <div ref={ref}><p>Message</p><textarea aria-label="Draft" /></div>
    }
    const view = render(<QueryClientProvider client={client}><Chat /></QueryClientProvider>)
    return { ...view, client, message: view.getByText('Message') }
}

function swipe(target: Element, dx: number, dy = 1) {
    fireEvent.touchStart(target, { touches: [{ clientX: 180, clientY: 180 }] })
    fireEvent.touchEnd(target, { changedTouches: [{ clientX: 180 + dx, clientY: 180 + dy }] })
}

describe('chat swipe navigation', () => {
    it.each([
        ['first', -100, 'second'],
        ['second', 100, 'first'],
        ['second', -100, 'third'],
        ['third', 100, 'second'],
    ])('swipes from %s by %i to visible neighbor %s', (id, dx, next) => {
        swipe(mount(id).message, dx)
        expect(navigate).toHaveBeenCalledExactlyOnceWith({
            to: '/sessions/$sessionId', params: { sessionId: next }, resetScroll: false,
        })
    })

    it.each([['first', 100], ['third', -100]])('stays at the %s edge without opening files or the list', (id, dx) => {
        swipe(mount(id).message, dx)
        expect(navigate).not.toHaveBeenCalled()
    })

    it('stays in a group with a single visible tab in both directions', () => {
        const { message } = mount('first', [{ ...group, members: [group.members[1]] }])
        swipe(message, -100)
        swipe(message, 100)
        expect(navigate).not.toHaveBeenCalled()
    })

    it('leaves vertical scrolling, short drags and composer touches alone', () => {
        const view = mount('second')
        swipe(view.message, -80, 150)
        swipe(view.message, -20)
        swipe(view.getByRole('textbox'), -100)
        expect(navigate).not.toHaveBeenCalled()
    })

    it('uses current membership after an update', async () => {
        const { message, client } = mount('second')
        await act(async () => {
            client.setQueryData(sessionGroupsKey, { groups: [{ ...group, members: group.members.slice(0, 2) }] })
            await new Promise(resolve => setTimeout(resolve, 0))
        })
        swipe(message, -100)
        expect(navigate).not.toHaveBeenCalled()
    })

    it('retains standalone chat swipes into files and back to sessions', () => {
        const { message } = mount('second', [])
        swipe(message, -100)
        expect(navigate).toHaveBeenLastCalledWith({
            to: '/sessions/$sessionId/files', params: { sessionId: 'second' },
            search: { tab: 'changes', display: 'diff' }, resetScroll: false,
        })
        swipe(message, 100)
        expect(navigate).toHaveBeenLastCalledWith({ to: '/sessions', resetScroll: false })
    })

    it('waits for group membership before allowing navigation to files', () => {
        const { message } = mount('first', null)
        swipe(message, -100)
        expect(navigate).not.toHaveBeenCalled()
    })
})
