import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
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

function deferred() {
    let resolve!: () => void
    let reject!: (error: Error) => void
    const promise = new Promise<void>((res, rej) => {
        resolve = res
        reject = rej
    })
    return { promise, resolve, reject }
}

const clients: QueryClient[] = []
afterEach(() => {
    for (const client of clients.splice(0)) client.clear()
})

function renderChat(provider: string, api: Record<string, unknown>) {
    context.conversationId = `${provider}:chat:1`
    context.api = {
        getMessengerConnections: async () => ({ connections: [] }),
        getExternalConversations: async () => ({ conversations: [{
            id: context.conversationId, provider, remoteId: '1', title: 'Test conversation',
            kind: 'direct', selected: true, unreadCount: 0, lastMessageAt: null, lastMessagePreview: null,
        }] }),
        getExternalMessages: async () => ({ messages: [], participants: [] }),
        setConversationActive: vi.fn(async () => {}),
        ...api,
    }
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    clients.push(client)
    const view = render(<QueryClientProvider client={client}><I18nProvider><ChatConversationPage /></I18nProvider></QueryClientProvider>)
    return { client, ...view }
}

function submit(text: string) {
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: text } })
    const button = screen.getByTitle('Send')
    expect(button).toBeEnabled()
    fireEvent.click(button)
    expect(input).toHaveValue('')
}

describe('messenger background sends', () => {
    it.each(['telegram', 'yandex'])('keeps %s sends ordered and visible through refreshes while the next draft remains editable', async (provider) => {
        const first = deferred()
        const second = deferred()
        const serverMessages: ExternalMessage[] = []
        const send = vi.fn(async (_id: string, text: string) => {
            await (text === 'first' ? first.promise : second.promise)
            serverMessages.push({
                id: text, conversationId: context.conversationId, providerMessageId: text,
                senderId: 'me', senderName: 'Me', direction: 'outgoing', text,
                createdAt: Date.now(), editedAt: null, media: [],
            })
        })
        const { client } = renderChat(provider, {
            sendExternalMessage: send,
            getExternalMessages: async () => ({ messages: [...serverMessages], participants: [] }),
        })
        await screen.findByRole('textbox')
        submit('first')
        await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
        submit('second')
        await screen.findByText('second')
        expect(send).toHaveBeenCalledTimes(1)
        fireEvent.change(screen.getByRole('textbox'), { target: { value: 'next draft' } })
        await act(async () => client.invalidateQueries({ queryKey: queryKeys.externalMessages(context.conversationId) }))
        expect(screen.getByText('first')).toBeInTheDocument()
        expect(screen.getByText('second')).toBeInTheDocument()
        await act(async () => first.resolve())
        await waitFor(() => expect(send).toHaveBeenCalledTimes(2))
        expect(screen.getByText('second')).toBeInTheDocument()
        await act(async () => second.resolve())
        await waitFor(() => expect(screen.queryByLabelText('Sending')).toBeNull())
        expect(screen.getByRole('textbox')).toHaveValue('next draft')
        expect(send.mock.calls.map((call) => call[1])).toEqual(['first', 'second'])
        expect(screen.getAllByText('first')).toHaveLength(1)
        expect(screen.getAllByText('second')).toHaveLength(1)
    })

    it('retains a failed message for retry without restoring over the next draft, including after a remount', async () => {
        const request = deferred()
        const send = vi.fn().mockImplementationOnce(() => request.promise).mockResolvedValue(undefined)
        const { rerender } = renderChat('telegram', { sendExternalMessage: send })
        await screen.findByRole('textbox')
        submit('failed message')
        await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
        fireEvent.change(screen.getByRole('textbox'), { target: { value: 'next draft' } })
        await act(async () => request.reject(new Error('Connection lost')))
        await screen.findByRole('button', { name: 'Retry' })
        expect(screen.getByRole('textbox')).toHaveValue('next draft')
        expect(screen.getByText('failed message')).toBeInTheDocument()
        const client = clients[clients.length - 1]
        rerender(<QueryClientProvider client={client}><I18nProvider><ChatConversationPage key="remounted" /></I18nProvider></QueryClientProvider>)
        fireEvent.click(await screen.findByRole('button', { name: 'Retry' }))
        await waitFor(() => expect(send).toHaveBeenCalledTimes(2))
        expect(send.mock.calls[1]).toEqual(send.mock.calls[0])
    })

    it('snapshots media captions and leaves the next draft intact after uploading', async () => {
        const upload = deferred()
        const sendMedia = vi.fn(() => upload.promise)
        const sendText = vi.fn(async () => {})
        const { container } = renderChat('yandex', { sendExternalMedia: sendMedia, sendExternalMessage: sendText })
        await screen.findByRole('textbox')
        fireEvent.change(screen.getByRole('textbox'), { target: { value: 'caption' } })
        const file = new File(['image'], 'photo.png', { type: 'image/png' })
        fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [file] } })
        expect(screen.getByRole('textbox')).toHaveValue('')
        await waitFor(() => expect(sendMedia).toHaveBeenCalledTimes(1))
        submit('next message')
        fireEvent.change(screen.getByRole('textbox'), { target: { value: 'next draft' } })
        await act(async () => upload.resolve())
        await waitFor(() => expect(sendText).toHaveBeenCalledTimes(1))
        expect(sendMedia.mock.calls[0]).toEqual([context.conversationId, file, 'caption', expect.any(String), undefined])
        expect(screen.getByRole('textbox')).toHaveValue('next draft')
    })
})
