import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ExternalMessage } from '@hapi/protocol/messengers'
import { I18nProvider } from '@/lib/i18n-context'
import { ImagePreviewProvider } from '@/components/ImagePreview'
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
    vi.unstubAllGlobals()
})

function renderChat(api: Record<string, unknown> = {}, provider = 'telegram') {
    context.conversationId = `${provider}:chat:1`
    context.api = {
        getMessengerConnections: async () => ({ connections: [] }),
        getExternalConversations: async () => ({ conversations: [{
            id: context.conversationId, provider, remoteId: '1', title: 'Test conversation',
            kind: 'direct', selected: true, unreadCount: 0, lastMessageAt: null, lastMessagePreview: null,
        }] }),
        getExternalMessages: async () => ({ messages: [message], participants: [] }),
        setConversationActive: vi.fn(async () => {}),
        ...api,
    }
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    clients.push(client)
    render(<QueryClientProvider client={client}><I18nProvider><ImagePreviewProvider><ChatConversationPage /></ImagePreviewProvider></I18nProvider></QueryClientProvider>)
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
    it('keeps edit and delete out of the menu for incoming messages', async () => {
        renderChat()
        fireEvent.click(await screen.findByText('hello bubble'))
        expect(screen.getByRole('menuitem', { name: 'Reply' })).toBeVisible()
        expect(screen.queryByRole('menuitem', { name: 'Edit' })).toBeNull()
        expect(screen.queryByRole('menuitem', { name: 'Delete' })).toBeNull()
    })

    it.each(['telegram', 'yandex'])('edits an own %s message, keeps failed edits, and restores the unsent draft', async (provider) => {
        const own = { ...message, direction: 'outgoing' as const }
        const editExternalMessage = vi.fn()
            .mockRejectedValueOnce(new Error('Editing is no longer allowed'))
            .mockResolvedValueOnce(undefined)
        const sendExternalMessage = vi.fn()
        renderChat({
            getExternalMessages: async () => ({ messages: [own], participants: [] }),
            editExternalMessage, sendExternalMessage,
        }, provider)
        const bubble = await screen.findByText('hello bubble')
        const composer = screen.getByRole('textbox')
        fireEvent.change(composer, { target: { value: 'unsent draft' } })
        fireEvent.click(bubble)
        fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }))
        expect(composer).toHaveValue('hello bubble')
        expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled()
        fireEvent.change(composer, { target: { value: 'corrected message' } })
        fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
        expect(await screen.findByRole('alert')).toHaveTextContent('Editing is no longer allowed')
        expect(composer).toHaveValue('corrected message')
        fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
        await waitFor(() => expect(composer).toHaveValue('unsent draft'))
        expect(editExternalMessage).toHaveBeenLastCalledWith(`${provider}:chat:1`, 'pm1', 'corrected message')
        expect(sendExternalMessage).not.toHaveBeenCalled()
        fireEvent.click(bubble)
        fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }))
        fireEvent.change(composer, { target: { value: 'abandoned edit' } })
        fireEvent.keyDown(composer, { key: 'Escape' })
        expect(composer).toHaveValue('unsent draft')
        expect(editExternalMessage).toHaveBeenCalledTimes(2)
    })

    it.each(['telegram', 'yandex'])('requires confirmation to delete an own %s message and retains a provider error', async (provider) => {
        const own = { ...message, direction: 'outgoing' as const }
        let history = [own]
        const deleteExternalMessage = vi.fn()
            .mockRejectedValueOnce(new Error('Cannot delete this message'))
            .mockImplementationOnce(async () => { history = [] })
        renderChat({
            getExternalMessages: async () => ({ messages: history, participants: [] }),
            deleteExternalMessage,
        }, provider)
        fireEvent.click(await screen.findByText('hello bubble'))
        fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }))
        expect(deleteExternalMessage).not.toHaveBeenCalled()
        fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }))
        expect(deleteExternalMessage).not.toHaveBeenCalled()
        fireEvent.click(screen.getByText('hello bubble'))
        fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }))
        fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }))
        expect(await screen.findByText('Cannot delete this message')).toBeVisible()
        expect(screen.getByRole('dialog')).toBeVisible()
        fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }))
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
        await waitFor(() => expect(screen.queryByText('hello bubble')).toBeNull())
        expect(deleteExternalMessage).toHaveBeenLastCalledWith(`${provider}:chat:1`, 'pm1')
    })

    it('labels an animated MP4 as GIF in both the reply quote and composer preview', async () => {
        // Keep the thumbnail visible without fetching the original media.
        vi.stubGlobal('IntersectionObserver', class {
            observe() {}
            disconnect() {}
        })
        renderChat({
            getExternalMessages: async () => ({ messages: [
                { ...message, text: '', media: [{
                    kind: 'video', isAnimated: true, mimeType: 'video/mp4', fileName: null,
                    size: 100, thumbnailDataUrl: 'data:image/png;base64,aA==',
                }] },
                { ...message, id: 'm2', providerMessageId: 'pm2', text: 'reply to animation',
                    createdAt: message.createdAt + 1000, replyToProviderMessageId: 'pm1' }
            ], participants: [] }),
        })
        const quote = await screen.findByRole('button', { name: 'Alice GIF' })
        expect(quote).toBeVisible()
        fireEvent.contextMenu(screen.getByRole('img', { name: 'GIF' }), { clientX: 120, clientY: 200 })
        fireEvent.click(screen.getByRole('menuitem', { name: 'Reply' }))
        expect(screen.getByTestId('chats-reply-bar')).toHaveTextContent('GIF')
        expect(screen.getByTestId('chats-reply-bar')).not.toHaveTextContent('Video')
    })

    it.each(['left', 'right'])('opens reactions and reply/copy actions on a %s click on text', async (button) => {
        const setExternalMessageReactions = vi.fn(async () => {})
        renderChat({ setExternalMessageReactions })
        const bubble = await screen.findByText('hello bubble')
        const openMenu = () => {
            if (button === 'left') fireEvent.click(bubble, { clientX: 120, clientY: 200 })
            else fireEvent.contextMenu(bubble, { clientX: 120, clientY: 200 })
        }
        openMenu()
        expect(screen.getByRole('group', { name: 'Message reactions' })).toBeVisible()
        expect(screen.getByRole('menuitem', { name: 'Copy Text' })).toBeVisible()
        fireEvent.click(screen.getByRole('button', { name: 'Show all reactions' }))
        fireEvent.click(screen.getByRole('button', { name: 'React with 👻' }))
        await waitFor(() => expect(setExternalMessageReactions).toHaveBeenCalledWith('telegram:chat:1', 'pm1', ['emoji:👻']))
        expect(screen.queryByRole('menu')).toBeNull()
        openMenu()
        fireEvent.click(screen.getByRole('menuitem', { name: 'Reply' }))
        expect(screen.getByTestId('chats-reply-bar')).toHaveTextContent('hello bubble')
        expect(screen.getByRole('textbox')).toHaveFocus()
    })

    it('replies to a captionless image through its context menu and sends the reply reference', async () => {
        vi.stubGlobal('URL', class extends URL {
            static createObjectURL() { return 'blob:reply-image' }
            static revokeObjectURL() {}
        })
        const sendExternalMessage = vi.fn(async () => ({ message: { ...message, id: 'sent', providerMessageId: 'sent' } }))
        renderChat({
            getExternalMessages: async () => ({ messages: [{ ...message, text: '', media: [{
                kind: 'image', mimeType: 'image/png', fileName: 'photo.png', size: 100,
                thumbnailDataUrl: 'data:image/png;base64,aA==',
            }] }], participants: [] }),
            getExternalMediaBlob: async () => new Blob(['image'], { type: 'image/png' }),
            sendExternalMessage,
        })
        fireEvent.click((await screen.findByRole('img', { name: 'Photo' })).closest('button')!)
        const image = await screen.findByRole('button', { name: /Photo.*photo.png/ })
        const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 120, clientY: 200 })
        fireEvent(image, event)
        expect(event.defaultPrevented).toBe(true)
        expect(screen.queryByRole('dialog')).toBeNull()
        fireEvent.click(screen.getByRole('menuitem', { name: 'Reply' }))
        expect(screen.queryByRole('menu')).toBeNull()
        expect(screen.getByTestId('chats-reply-bar')).toHaveTextContent('Alice')
        expect(screen.getByTestId('chats-reply-bar')).toHaveTextContent('Photo')
        const composer = screen.getByRole('textbox')
        expect(composer).toHaveFocus()
        fireEvent.change(composer, { target: { value: 'reply to photo' } })
        fireEvent.submit(composer.closest('form')!)
        await waitFor(() => expect(sendExternalMessage).toHaveBeenCalledWith(
            'telegram:chat:1', 'reply to photo', expect.any(String), 'pm1',
        ))
    })

    it('renews composer focus on reply when it was already focused without a keyboard', async () => {
        renderChat()
        const bubble = await screen.findByText('hello bubble')
        const composer = screen.getByRole('textbox')
        // Opening a chat focuses the field outside a touch gesture. Mobile
        // browsers can leave it focused while the software keyboard is hidden.
        expect(composer).toHaveFocus()
        const focus = vi.fn()
        composer.addEventListener('focus', focus)

        swipe(bubble, [{ x: 300, y: 400 }, { x: 240, y: 401 }])

        expect(screen.getByTestId('chats-reply-bar')).toHaveTextContent('Alice')
        expect(composer).toHaveFocus()
        expect(focus).toHaveBeenCalledTimes(1)
    })

    it('starts a reply on double-click and focuses the composer', async () => {
        renderChat()
        const bubble = await screen.findByText('hello bubble')
        fireEvent.doubleClick(bubble)
        const bar = screen.getByTestId('chats-reply-bar')
        expect(bar).toHaveTextContent('Alice')
        expect(bar).toHaveTextContent('hello bubble')
        expect(screen.getByRole('textbox')).toHaveFocus()
    })

    it.each([
        { direction: 'left', delta: -60 },
        { direction: 'right', delta: 60 },
    ])('starts a reply on a $direction swipe and ignores vertical scrolling and short drags', async ({ delta }) => {
        renderChat()
        const bubble = await screen.findByText('hello bubble')
        swipe(bubble, [{ x: 300, y: 400 }, { x: 300 + delta, y: 401 }])
        expect(screen.getByTestId('chats-reply-bar')).toHaveTextContent('Alice')
        expect(screen.getByRole('textbox')).toHaveFocus()
        fireEvent.click(screen.getByRole('button', { name: 'Cancel reply' }))

        swipe(bubble, [{ x: 300, y: 400 }, { x: 300 + Math.sign(delta), y: 430 }, { x: 300 + delta, y: 460 }])
        expect(screen.queryByTestId('chats-reply-bar')).toBeNull()

        swipe(bubble, [{ x: 300, y: 400 }, { x: 300 + Math.sign(delta) * 15, y: 401 }])
        expect(screen.queryByTestId('chats-reply-bar')).toBeNull()

        // The bubble springs back to rest after every gesture.
        const wrapper = document.querySelector('.touch-pan-y') as HTMLElement
        await waitFor(() => expect(wrapper).not.toHaveAttribute('style', /transform:/))
    })

    it('starts a reply from a swipe on the empty space of the row', async () => {
        renderChat()
        const bubble = await screen.findByText('hello bubble')
        const row = bubble.closest('[data-provider-message-id]') as HTMLElement
        const wrapper = row.querySelector('.touch-pan-y') as HTMLElement
        expect(wrapper).not.toBeNull()

        // Mid-gesture the bubble itself follows the finger, not the row.
        fireEvent.touchStart(row, { touches: [touchAt(300, 400)] })
        fireEvent.touchMove(row, { touches: [touchAt(250, 400)] })
        expect(wrapper).toHaveAttribute('style', expect.stringContaining('translateX(-50px)'))
        expect(row).not.toHaveAttribute('style', /transform:/)

        fireEvent.touchEnd(row, { touches: [], changedTouches: [touchAt(240, 400)] })
        expect(screen.getByTestId('chats-reply-bar')).toHaveTextContent('Alice')
        expect(wrapper).not.toHaveAttribute('style', /transform:/)
    })
})
