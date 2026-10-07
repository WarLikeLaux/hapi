// Scroll-to-bottom behavior of the messenger conversation pane.
//
// Geometry is stubbed deterministically (every element reports scrollHeight
// 5000 / clientHeight 800), so "scrolled to the newest message" is simply
// viewport.scrollTop === 5000.
import { act, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ExternalMessage } from '@hapi/protocol/messengers'
import { I18nProvider } from '@/lib/i18n-context'
import { queryKeys } from '@/lib/query-keys'
import { ChatConversationPage } from './chats'

const context = vi.hoisted(() => ({ conversationId: '', api: {} as Record<string, unknown> }))
vi.mock('@tanstack/react-router', () => ({
    useParams: () => ({ conversationId: context.conversationId }),
    useNavigate: () => vi.fn(),
}))
vi.mock('@/lib/app-context', () => ({ useAppContext: () => ({ api: context.api }) }))
vi.mock('@/components/KlipyGifPicker', () => ({ KlipyGifPicker: () => null }))

const clients: QueryClient[] = []
let restoreGeometry: (() => void) | null = null

afterEach(() => {
    for (const client of clients.splice(0)) client.clear()
    restoreGeometry?.()
    restoreGeometry = null
})

function stubScrollGeometry() {
    const previous: Array<[PropertyKey, PropertyDescriptor | undefined]> = [
        ['scrollHeight', Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight')],
        ['clientHeight', Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight')],
    ]
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get() { return 5000 } })
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return 800 } })
    restoreGeometry = () => {
        for (const [key, descriptor] of previous) {
            if (descriptor) Object.defineProperty(HTMLElement.prototype, key, descriptor)
            else delete (HTMLElement.prototype as unknown as Record<PropertyKey, unknown>)[key]
        }
    }
}

function message(id: string, text: string, direction: 'incoming' | 'outgoing' = 'incoming'): ExternalMessage {
    return {
        id, conversationId: context.conversationId, providerMessageId: id,
        senderId: 'peer', senderName: 'Peer', direction, text,
        createdAt: Date.now(), editedAt: null, media: [],
    }
}

function conversation(id: string) {
    return {
        id, provider: 'telegram', remoteId: '1', title: 'Test conversation',
        kind: 'direct' as const, selected: true, unreadCount: 0, lastMessageAt: null, lastMessagePreview: null,
    }
}

function baseApi(overrides: Record<string, unknown> = {}) {
    return {
        getMessengerConnections: async () => ({ connections: [] }),
        setConversationActive: vi.fn(async () => {}),
        ...overrides,
    }
}

// Let the mount-time rAF callbacks fire (jsdom schedules them on a ~16ms
// timer), mirroring a real browser where they run long before a fetch
// response arrives.
function flushFrames() {
    return act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 60))
    })
}

function viewport(container: HTMLElement): HTMLElement {
    const node = container.querySelector<HTMLElement>('.overflow-y-auto')
    if (!node) throw new Error('chat viewport not mounted')
    return node
}

function renderPane(client: QueryClient) {
    clients.push(client)
    return render(
        <QueryClientProvider client={client}>
            <I18nProvider>
                <ChatConversationPage />
            </I18nProvider>
        </QueryClientProvider>
    )
}

function seedMessages(client: QueryClient, conversationId: string, messages: ExternalMessage[]) {
    client.setQueryData(queryKeys.externalMessages(conversationId), { messages, participants: [] })
}

describe('chats scroll-to-bottom', () => {
    it('opens scrolled to the newest message when the messages response lands before the conversations list (cold open into a chat)', async () => {
        stubScrollGeometry()
        context.conversationId = 'tg:chat:1'
        let resolveConversations!: (value: { conversations: ReturnType<typeof conversation>[] }) => void
        let resolveMessages!: (value: { messages: ExternalMessage[]; participants: never[] }) => void
        context.api = baseApi({
            getExternalConversations: () => new Promise((resolve) => { resolveConversations = resolve }),
            getExternalMessages: () => new Promise((resolve) => { resolveMessages = resolve }),
        })
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
        const view = renderPane(client)
        expect(screen.getByText('Loading…')).toBeInTheDocument()
        await act(async () => {
            resolveMessages({ messages: [message('m1', 'hello'), message('m2', 'latest')], participants: [] })
        })
        // The pane's mount-time effects and rAFs fire while the loading
        // placeholder is still up — before the conversations response lifts it.
        await flushFrames()
        await act(async () => {
            resolveConversations({ conversations: [conversation(context.conversationId)] })
        })
        await screen.findByText('latest')
        await flushFrames()
        expect(viewport(view.container).scrollTop).toBe(5000)
    })

    it('opens scrolled to the newest message with the conversation and messages already cached', async () => {
        stubScrollGeometry()
        context.conversationId = 'tg:chat:1'
        context.api = baseApi({
            getExternalConversations: async () => ({ conversations: [conversation(context.conversationId)] }),
            getExternalMessages: async () => ({ messages: [message('m1', 'hello'), message('m2', 'latest')], participants: [] }),
        })
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
        client.setQueryData(queryKeys.externalConversations, [conversation(context.conversationId)])
        seedMessages(client, context.conversationId, [message('m1', 'hello'), message('m2', 'latest')])
        const view = renderPane(client)
        await screen.findByText('latest')
        await flushFrames()
        expect(viewport(view.container).scrollTop).toBe(5000)
    })

    it('keeps the view pinned to the newest message when one arrives while the chat is open', async () => {
        stubScrollGeometry()
        context.conversationId = 'tg:chat:1'
        context.api = baseApi({
            getExternalConversations: async () => ({ conversations: [conversation(context.conversationId)] }),
            getExternalMessages: async () => ({ messages: [message('m1', 'hello')], participants: [] }),
        })
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
        client.setQueryData(queryKeys.externalConversations, [conversation(context.conversationId)])
        seedMessages(client, context.conversationId, [message('m1', 'hello')])
        const view = renderPane(client)
        await screen.findByText('hello')
        await flushFrames()
        expect(viewport(view.container).scrollTop).toBe(5000)
        await act(async () => {
            seedMessages(client, context.conversationId, [message('m1', 'hello'), message('m2', 'newest')])
        })
        await screen.findByText('newest')
        await flushFrames()
        expect(viewport(view.container).scrollTop).toBe(5000)
    })

    it('lands at the bottom of the new chat when switching conversations inside the same pane', async () => {
        stubScrollGeometry()
        context.conversationId = 'tg:chat:1'
        context.api = baseApi({
            getExternalConversations: async () => ({ conversations: [conversation('tg:chat:1'), conversation('tg:chat:2')] }),
            getExternalMessages: async () => ({ messages: [], participants: [] }),
        })
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
        client.setQueryData(queryKeys.externalConversations, [conversation('tg:chat:1'), conversation('tg:chat:2')])
        seedMessages(client, 'tg:chat:1', [message('a1', 'chat one latest')])
        seedMessages(client, 'tg:chat:2', [message('b1', 'chat two latest')])
        const view = renderPane(client)
        await screen.findByText('chat one latest')
        await flushFrames()
        expect(viewport(view.container).scrollTop).toBe(5000)
        context.conversationId = 'tg:chat:2'
        await act(async () => {
            view.rerender(
                <QueryClientProvider client={client}>
                    <I18nProvider>
                        <ChatConversationPage />
                    </I18nProvider>
                </QueryClientProvider>
            )
        })
        await screen.findByText('chat two latest')
        await flushFrames()
        expect(viewport(view.container).scrollTop).toBe(5000)
    })

    it('holds the reading position when media loads into history above it', async () => {
        stubScrollGeometry()
        // A manually driven ResizeObserver stand-in: the compensation branch is
        // what fires from it, so the test triggers it directly.
        class FakeResizeObserver {
            static instances: Array<{ callback: ResizeObserverCallback; observed: Element | null }> = []
            observed: Element | null = null
            constructor(public callback: ResizeObserverCallback) {
                FakeResizeObserver.instances.push(this)
            }
            observe(target: Element) { this.observed = target }
            unobserve() {} disconnect() {}
        }
        vi.stubGlobal('ResizeObserver', FakeResizeObserver)
        context.conversationId = 'tg:chat:1'
        context.api = baseApi({
            getExternalConversations: async () => ({ conversations: [conversation(context.conversationId)] }),
            getExternalMessages: async () => ({ messages: [message('m1', 'hello'), message('m2', 'latest')], participants: [] }),
        })
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
        client.setQueryData(queryKeys.externalConversations, [conversation(context.conversationId)])
        seedMessages(client, context.conversationId, [message('m1', 'hello'), message('m2', 'latest')])
        const view = renderPane(client)
        await screen.findByText('latest')
        await flushFrames()
        const vp = viewport(view.container)
        expect(vp.scrollTop).toBe(5000)

        // The reader scrolls up into history: the pin releases and the topmost
        // visible message becomes the reading-position anchor.
        vp.scrollTop = 1000
        const anchorNode = screen.getByText('hello').closest('[data-provider-message-id]')
        if (!anchorNode) throw new Error('anchor message not mounted')
        const domRect = (top: number) => ({ top, left: 0, width: 800, height: 800, x: 0, y: top, right: 800, bottom: top + 800, toJSON: () => ({}) }) as DOMRect
        const viewportRect = vi.spyOn(vp, 'getBoundingClientRect').mockReturnValue(domRect(0))
        const anchorRect = vi.spyOn(anchorNode as HTMLElement, 'getBoundingClientRect').mockReturnValue(domRect(100))
        await act(async () => {
            vp.dispatchEvent(new WheelEvent('wheel', { deltaY: -900, bubbles: true }))
            vp.dispatchEvent(new Event('scroll', { bubbles: true }))
        })
        expect(vp.scrollTop).toBe(1000)

        // Media above the anchor finishes loading and pushes it down 192px; the
        // content resize observer must scroll by exactly that delta.
        anchorRect.mockReturnValue(domRect(292))
        const observer = FakeResizeObserver.instances.find((entry) => entry.observed != null && entry.observed.parentElement === vp)
        if (!observer) throw new Error('content ResizeObserver not registered')
        await act(async () => {
            observer.callback([], observer as unknown as ResizeObserver)
        })
        expect(vp.scrollTop).toBe(1192)

        // A later fire with no further movement must not keep scrolling.
        await act(async () => {
            observer.callback([], observer as unknown as ResizeObserver)
        })
        expect(vp.scrollTop).toBe(1192)
        viewportRect.mockRestore()
        anchorRect.mockRestore()
        vi.unstubAllGlobals()
    })

    it('opens scrolled to the newest message when the conversations list resolves first and messages arrive later', async () => {
        stubScrollGeometry()
        context.conversationId = 'tg:chat:1'
        let resolveMessages!: (value: { messages: ExternalMessage[]; participants: never[] }) => void
        context.api = baseApi({
            getExternalConversations: async () => ({ conversations: [conversation(context.conversationId)] }),
            getExternalMessages: () => new Promise((resolve) => { resolveMessages = resolve }),
        })
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
        const view = renderPane(client)
        await screen.findByText('Test conversation')
        await act(async () => {
            resolveMessages({ messages: [message('m1', 'hello'), message('m2', 'latest')], participants: [] })
        })
        await screen.findByText('latest')
        await flushFrames()
        expect(viewport(view.container).scrollTop).toBe(5000)
    })
})
