import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExternalMessage } from '@hapi/protocol/messengers'
import { I18nProvider } from '@/lib/i18n-context'
import { clearDraft } from '@/lib/composer-drafts'
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
beforeEach(() => {
    for (const provider of ['telegram', 'yandex']) clearDraft(`external::${provider}:chat:1`)
})
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
    it('restores an unsent draft after leaving a conversation and clears it after sending', async () => {
        const send = vi.fn(async () => {})
        const view = renderChat('telegram', { sendExternalMessage: send })
        await screen.findByRole('textbox')
        fireEvent.change(screen.getByRole('textbox'), { target: { value: 'unfinished message\nwith another line' } })
        view.unmount()
        const next = renderChat('yandex', {})
        expect(await screen.findByRole('textbox')).toHaveValue('')
        fireEvent.change(screen.getByRole('textbox'), { target: { value: 'separate draft' } })
        next.unmount()
        const restored = renderChat('telegram', { sendExternalMessage: send })
        expect(await screen.findByRole('textbox')).toHaveValue('unfinished message\nwith another line')
        fireEvent.click(screen.getByTitle('Send'))
        await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
        restored.unmount()
        renderChat('telegram', { sendExternalMessage: send })
        expect(await screen.findByRole('textbox')).toHaveValue('')
    })

    it('keeps text and selection when expanding and collapsing the editor', async () => {
        renderChat('telegram', {})
        const input = await screen.findByRole('textbox') as HTMLTextAreaElement
        fireEvent.change(input, { target: { value: 'A long message with a selected fragment' } })
        input.setSelectionRange(7, 14)
        fireEvent.click(screen.getByRole('button', { name: 'Expand message editor' }))
        expect(screen.getByRole('textbox')).toHaveValue('A long message with a selected fragment')
        expect(input.selectionStart).toBe(7)
        expect(input.selectionEnd).toBe(14)
        expect(input).toHaveFocus()
        fireEvent.keyDown(input, { key: 'Escape' })
        expect(screen.getByRole('button', { name: 'Expand message editor' })).toBeVisible()
        expect(input.selectionStart).toBe(7)
        expect(input.selectionEnd).toBe(14)
    })

    it('sends a selected Yandex sticker with a retryable preview while preserving the text draft', async () => {
        const send = vi.fn().mockRejectedValueOnce(new Error('Connection lost')).mockResolvedValue(undefined)
        const { container } = renderChat('yandex', {
            getYandexStickerPack: async () => ({ pack: {
                id: '5047', title: 'Свинопасный',
                stickers: [{ id: 'stickers/images/5047/50503.png', text: '🫠' }]
            } }),
            sendExternalSticker: send
        })
        await screen.findByRole('textbox')
        fireEvent.change(screen.getByRole('textbox'), { target: { value: 'unfinished draft' } })
        fireEvent.click(screen.getByRole('button', { name: 'Send sticker' }))
        fireEvent.click(await screen.findByRole('button', { name: 'Send sticker 🫠' }))
        const retry = await screen.findByRole('button', { name: 'Retry' })
        expect(screen.queryByRole('dialog')).toBeNull()
        expect(screen.getByRole('textbox')).toHaveValue('unfinished draft')
        expect(container.querySelector('img[alt="Sticker"]')).toHaveAttribute('src', 'https://files.messenger.yandex.net/stickers/images/5047/50503.png')
        expect(send.mock.calls[0]).toEqual([context.conversationId, {
            stickerId: 'stickers/images/5047/50503.png', setId: '5047',
            clientId: expect.any(String), replyToProviderMessageId: undefined
        }])
        fireEvent.click(retry)
        await waitFor(() => expect(send).toHaveBeenCalledTimes(2))
        expect(send.mock.calls[1]).toEqual(send.mock.calls[0])
        expect(screen.getByRole('textbox')).toHaveValue('unfinished draft')
    })

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

    it('stages multiple selected and pasted images, removes one, and sends the caption only once', async () => {
        const sendMedia = vi.fn(async (_id: string, _file: File, _text: string) => {})
        const { container } = renderChat('telegram', { sendExternalMedia: sendMedia })
        const input = await screen.findByRole('textbox')
        fireEvent.change(input, { target: { value: 'caption for these photos' } })
        const files = ['first.png', 'removed.png', 'pasted.png', 'last.png'].map(name => new File(['image'], name, { type: 'image/png' }))
        fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: files.slice(0, 2) } })
        fireEvent.paste(input, { clipboardData: { items: files.slice(2).map(file => ({ kind: 'file', type: file.type, getAsFile: () => file })) } })
        expect(screen.getAllByRole('button', { name: /Remove attachment/ })).toHaveLength(4)
        fireEvent.click(screen.getByRole('button', { name: 'Remove attachment removed.png' }))
        expect(sendMedia).not.toHaveBeenCalled()
        expect(input).toHaveValue('caption for these photos')
        fireEvent.click(screen.getByTitle('Send'))
        await waitFor(() => expect(sendMedia).toHaveBeenCalledTimes(3))
        expect(sendMedia.mock.calls.map(call => call.slice(0, 3))).toEqual([
            [context.conversationId, files[0], 'caption for these photos'],
            [context.conversationId, files[2], ''],
            [context.conversationId, files[3], ''],
        ])
        expect(screen.queryByTestId('chats-pending-media')).toBeNull()
        expect(input).toHaveValue('')
    })

    it.each([false, true])('stages files dropped into the chat with the editor expanded: %s', async (expanded) => {
        const sendMedia = vi.fn(async () => {})
        const { container } = renderChat('telegram', { sendExternalMedia: sendMedia })
        const editor = await screen.findByRole('textbox')
        fireEvent.change(editor, { target: { value: 'keep my draft' } })
        const existing = new File(['existing'], 'existing.txt', { type: 'text/plain' })
        fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [existing] } })
        if (expanded) fireEvent.click(screen.getByRole('button', { name: 'Expand message editor' }))
        const target = expanded ? editor : container.querySelector('header')!
        const files = [new File(['photo'], 'dropped.png', { type: 'image/png' }), new File(['pdf'], 'document.pdf', { type: 'application/pdf' })]
        const dataTransfer = { types: ['Files'], files, dropEffect: 'none' }
        const drag = new Event('dragover', { bubbles: true, cancelable: true })
        Object.defineProperty(drag, 'dataTransfer', { value: dataTransfer })
        fireEvent(target, drag)
        expect(drag.defaultPrevented).toBe(true)
        expect(dataTransfer.dropEffect).toBe('copy')
        fireEvent.drop(target, { dataTransfer })
        for (const name of ['existing.txt', 'dropped.png', 'document.pdf']) {
            expect(screen.getByRole('button', { name: `Remove attachment ${name}` })).toBeVisible()
        }
        expect(editor).toHaveValue('keep my draft')
        expect(editor).toHaveFocus()
        expect(sendMedia).not.toHaveBeenCalled()
    })

    it('keeps text drops native and blocks file drops while editing a sent message', async () => {
        renderChat('telegram', { getExternalMessages: async () => ({ messages: [{
            id: 'own', conversationId: context.conversationId, providerMessageId: 'own', senderId: 'me', senderName: 'Me',
            direction: 'outgoing', text: 'sent message', createdAt: Date.now(), editedAt: null, media: [],
        }], participants: [] }) })
        const editor = await screen.findByRole('textbox')
        const textDrop = new Event('drop', { bubbles: true, cancelable: true })
        Object.defineProperty(textDrop, 'dataTransfer', { value: { types: ['text/plain'], files: [] } })
        fireEvent(editor, textDrop)
        expect(textDrop.defaultPrevented).toBe(false)
        fireEvent.click(await screen.findByText('sent message'))
        fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }))
        const fileDrop = new Event('drop', { bubbles: true, cancelable: true })
        Object.defineProperty(fileDrop, 'dataTransfer', { value: { types: ['Files'], files: [new File(['data'], 'blocked.txt')] } })
        fireEvent(editor, fileDrop)
        expect(fileDrop.defaultPrevented).toBe(true)
        expect(screen.queryByTestId('chats-pending-media')).toBeNull()
        expect(editor).toHaveValue('sent message')
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
        expect(screen.getByRole('textbox')).toHaveValue('caption')
        expect(sendMedia).not.toHaveBeenCalled()
        fireEvent.click(screen.getByTitle('Send'))
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
