import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ExternalMessage } from '@hapi/protocol/messengers'
import { I18nProvider } from '@/lib/i18n-context'
import { ChatConversationPage } from './chats'

const context = vi.hoisted(() => ({ conversationId: '', api: {} as Record<string, unknown> }))
vi.mock('@tanstack/react-router', () => ({
    useParams: () => ({ conversationId: context.conversationId }),
    useNavigate: () => vi.fn(),
}))
vi.mock('@/lib/app-context', () => ({ useAppContext: () => ({ api: context.api }) }))
vi.mock('@/components/KlipyGifPicker', () => ({ KlipyGifPicker: () => null }))

const message: ExternalMessage = {
    id: 'm1', conversationId: 'telegram:chat:1', providerMessageId: 'pm1',
    senderId: 'them', senderName: 'Alice', direction: 'incoming', text: 'hello bubble',
    createdAt: Date.now(), editedAt: null, media: [],
}

const clients: QueryClient[] = []
afterEach(() => {
    for (const client of clients.splice(0)) client.clear()
})

function renderChat(api: Record<string, unknown> = {}) {
    context.conversationId = 'telegram:chat:1'
    context.api = {
        getMessengerConnections: async () => ({ connections: [] }),
        getExternalConversations: async () => ({ conversations: [{
            id: context.conversationId, provider: 'telegram', remoteId: '1', title: 'Test conversation',
            kind: 'direct', selected: true, unreadCount: 0, lastMessageAt: null, lastMessagePreview: null,
        }] }),
        getExternalMessages: async () => ({ messages: [message], participants: [] }),
        setConversationActive: vi.fn(async () => {}),
        ...api,
    }
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    clients.push(client)
    render(<QueryClientProvider client={client}><I18nProvider><ChatConversationPage /></I18nProvider></QueryClientProvider>)
}

function touchAt(x: number, y: number) {
    return { clientX: x, clientY: y }
}

function swipe(element: Element, points: Array<{ x: number; y: number }>) {
    const [start, ...rest] = points
    fireEvent.touchStart(element, { touches: [touchAt(start.x, start.y)] })
    for (const point of rest) fireEvent.touchMove(element, { touches: [touchAt(point.x, point.y)] })
    const last = points.at(-1)!
    fireEvent.touchEnd(element, { touches: [], changedTouches: [touchAt(last.x, last.y)] })
}

describe('messenger reply gestures', () => {
    it('starts a reply on double-click and focuses the composer', async () => {
        renderChat()
        const bubble = await screen.findByText('hello bubble')
        fireEvent.doubleClick(bubble)
        const bar = screen.getByTestId('chats-reply-bar')
        expect(bar).toHaveTextContent('Alice')
        expect(bar).toHaveTextContent('hello bubble')
        expect(screen.getByRole('textbox')).toHaveFocus()
    })

    it('starts a reply on a left swipe and ignores vertical scrolling and short drags', async () => {
        renderChat()
        const bubble = await screen.findByText('hello bubble')
        swipe(bubble, [{ x: 300, y: 400 }, { x: 240, y: 401 }])
        expect(screen.getByTestId('chats-reply-bar')).toHaveTextContent('Alice')
        fireEvent.click(screen.getByRole('button', { name: 'Cancel reply' }))

        swipe(bubble, [{ x: 300, y: 400 }, { x: 299, y: 430 }, { x: 260, y: 460 }])
        expect(screen.queryByTestId('chats-reply-bar')).toBeNull()

        swipe(bubble, [{ x: 300, y: 400 }, { x: 285, y: 401 }])
        expect(screen.queryByTestId('chats-reply-bar')).toBeNull()

        // The bubble springs back to rest after every gesture.
        await waitFor(() => expect(bubble).not.toHaveAttribute('style', /transform:/))
    })
})
