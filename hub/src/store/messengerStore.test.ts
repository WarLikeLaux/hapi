import { describe, expect, it } from 'bun:test'
import { Store } from './index'

function conversation(id: string, selected: boolean) {
    return {
        id: `telegram:${id}`,
        provider: 'telegram',
        remoteId: id,
        title: id,
        kind: 'direct' as const,
        selected,
        lastMessageAt: null,
        lastMessagePreview: null,
        unreadCount: 0
    }
}

describe('MessengerStore', () => {
    it.each([
        { isAnimated: true, text: '', expected: 'GIF' },
        { isAnimated: false, text: '', expected: 'Video' },
        { isAnimated: true, text: 'A caption', expected: 'A caption' }
    ])('keeps the correct video preview after storage and deletion: $expected', ({ isAnimated, text, expected }) => {
        const store = new Store(':memory:')
        try {
            store.messengers.upsertConversation('one', conversation('user:1', true))
            const message = {
                id: 'telegram:user:1:1', conversationId: 'telegram:user:1', providerMessageId: '1',
                senderId: 'user:1', senderName: 'Friend', direction: 'incoming' as const,
                text, createdAt: 1000, editedAt: null,
                media: [{ kind: 'video' as const, isAnimated, mimeType: 'video/mp4', fileName: null, size: 100, thumbnailDataUrl: null }]
            }
            store.messengers.upsertMessage('one', message)
            expect(store.messengers.listConversations('one')[0]?.lastMessagePreview).toBe(expected)
            store.messengers.upsertMessage('one', { ...message, id: 'telegram:user:1:2', providerMessageId: '2', text: 'newer', createdAt: 2000 })
            store.messengers.deleteMessages('one', 'telegram', ['2'], 'telegram:user:1')
            expect(store.messengers.getConversation('one', 'telegram:user:1')?.lastMessagePreview).toBe(expected)
        } finally {
            store.close()
        }
    })

    it('keeps selection and cached messages isolated by namespace', () => {
        const store = new Store(':memory:')
        try {
            store.messengers.upsertConversation('one', conversation('user:1', false))
            store.messengers.upsertConversation('one', conversation('user:2', false))
            store.messengers.upsertConversation('two', conversation('user:1', false))
            store.messengers.replaceSelection('one', 'telegram', ['user:1'])

            const selected = store.messengers.listConversations('one')
            expect(selected.map((item) => item.remoteId)).toEqual(['user:1'])
            expect(store.messengers.listConversations('one', false).map((item) => item.remoteId)).toEqual(['user:1', 'user:2'])
            expect(store.messengers.listConversations('two')).toEqual([])

            store.messengers.upsertMessage('one', {
                id: 'telegram:user:1:5',
                conversationId: 'telegram:user:1',
                providerMessageId: '5',
                senderId: 'user:1',
                senderName: 'Friend',
                senderAvatarDataUrl: 'data:image/jpeg;base64,dGVzdA==',
                direction: 'incoming',
                text: 'hello',
                createdAt: 1000,
                editedAt: null,
                media: [{
                    kind: 'image',
                    mimeType: 'image/jpeg',
                    fileName: null,
                    size: 128,
                    thumbnailDataUrl: 'data:image/jpeg;base64,dGVzdA=='
                }],
                reactions: [{ reaction: 'emoji:👍', emoji: '👍', count: 2, chosen: true }]
            })
            expect(store.messengers.listMessages('one', 'telegram:user:1')).toEqual([
                expect.objectContaining({
                    media: [expect.objectContaining({ kind: 'image', size: 128 })],
                    reactions: [{ reaction: 'emoji:👍', emoji: '👍', count: 2, chosen: true }]
                })
            ])
            expect(store.messengers.updateMessageReactions('one', 'telegram:user:1', '5', [
                { reaction: 'emoji:🔥', emoji: '🔥', count: 1, chosen: false }
            ])).toBe(true)
            expect(store.messengers.listMessages('one', 'telegram:user:1')[0]?.reactions).toEqual([
                { reaction: 'emoji:🔥', emoji: '🔥', count: 1, chosen: false }
            ])
            expect(store.messengers.listParticipants('one', 'telegram:user:1')).toEqual([{
                id: 'user:1',
                name: 'Friend',
                avatarDataUrl: 'data:image/jpeg;base64,dGVzdA=='
            }])
            store.messengers.upsertMessage('one', {
                id: 'telegram:user:1:6',
                conversationId: 'telegram:user:1',
                providerMessageId: '6',
                senderId: 'user:1',
                senderName: 'Friend',
                direction: 'incoming',
                text: '',
                createdAt: 2000,
                editedAt: null,
                media: [{ kind: 'voice', mimeType: 'audio/ogg', fileName: null, size: 512, thumbnailDataUrl: null }]
            })
            expect(store.messengers.getConversation('one', 'telegram:user:1')?.lastMessagePreview).toBe('Voice message')
            expect(store.messengers.hasMessage('one', 'telegram:user:1', '6')).toBe(true)
            store.messengers.incrementUnreadCount('one', 'telegram:user:1')
            expect(store.messengers.getConversation('one', 'telegram:user:1')?.unreadCount).toBe(1)
            store.messengers.setUnreadCount('one', 'telegram:user:1', 0)
            expect(store.messengers.getConversation('one', 'telegram:user:1')?.unreadCount).toBe(0)
            expect(store.messengers.listMessages('two', 'telegram:user:1')).toHaveLength(0)
        } finally {
            store.close()
        }
    })

    it('persists bot inline buttons and replaces them on message edits', () => {
        const store = new Store(':memory:')
        try {
            store.messengers.upsertConversation('one', conversation('user:1', true))
            const buttons = [[
                { id: '0:0', text: 'Next', kind: 'callback' as const },
                { id: '0:1', text: 'Open', kind: 'url' as const, url: 'https://example.com' }
            ]]
            store.messengers.upsertMessage('one', {
                id: 'telegram:user:1:7',
                conversationId: 'telegram:user:1',
                providerMessageId: '7',
                senderId: 'user:1',
                senderName: 'Bot',
                direction: 'incoming',
                text: 'choose',
                createdAt: 3000,
                editedAt: null,
                media: [],
                buttons
            })
            expect(store.messengers.listMessages('one', 'telegram:user:1')[0]?.buttons).toEqual(buttons)

            const edited: typeof buttons = [[{ id: '0:0', text: 'Restart', kind: 'callback' as const }]]
            store.messengers.upsertMessage('one', {
                id: 'telegram:user:1:7',
                conversationId: 'telegram:user:1',
                providerMessageId: '7',
                senderId: 'user:1',
                senderName: 'Bot',
                direction: 'incoming',
                text: 'choose again',
                createdAt: 3000,
                editedAt: 4000,
                media: [],
                buttons: edited
            })
            expect(store.messengers.listMessages('one', 'telegram:user:1')[0]?.buttons).toEqual(edited)

            // Messages without a keyboard stay schema-clean.
            store.messengers.upsertMessage('one', {
                id: 'telegram:user:1:8',
                conversationId: 'telegram:user:1',
                providerMessageId: '8',
                senderId: 'user:1',
                senderName: 'Bot',
                direction: 'incoming',
                text: 'plain',
                createdAt: 5000,
                editedAt: null,
                media: []
            })
            expect(store.messengers.listMessages('one', 'telegram:user:1')[1]?.buttons).toBeUndefined()
        } finally {
            store.close()
        }
    })

    it('preserves an explicit selection while refreshing remote metadata', () => {
        const store = new Store(':memory:')
        try {
            store.messengers.upsertConversation('default', conversation('user:7', false))
            store.messengers.replaceSelection('default', 'telegram', ['user:7'])
            store.messengers.upsertConversation('default', {
                ...conversation('user:7', false),
                title: 'Updated title',
                avatarDataUrl: 'data:image/jpeg;base64,dGVzdA=='
            })
            expect(store.messengers.listConversations('default')).toEqual([
                expect.objectContaining({
                    title: 'Updated title',
                    selected: true,
                    avatarDataUrl: 'data:image/jpeg;base64,dGVzdA=='
                })
            ])
        } finally {
            store.close()
        }
    })

    it('keeps local aliases while refreshing Telegram names', () => {
        const store = new Store(':memory:')
        try {
            store.messengers.upsertConversation('default', conversation('user:9', true))
            store.messengers.upsertMessage('default', {
                id: 'telegram:user:9:1', conversationId: 'telegram:user:9', providerMessageId: '1',
                senderId: 'user:9', senderName: 'Telegram friend', direction: 'incoming', text: 'hello',
                createdAt: 1, editedAt: null, media: []
            })

            store.messengers.setConversationAlias('default', 'telegram:user:9', 'Жека')
            store.messengers.setParticipantAlias('default', 'telegram:user:9', 'user:9', 'Бро')
            store.messengers.upsertConversation('default', { ...conversation('user:9', false), title: 'Updated Telegram name' })

            expect(store.messengers.getConversation('default', 'telegram:user:9')).toEqual(expect.objectContaining({
                title: 'Жека', sourceTitle: 'Updated Telegram name', customTitle: 'Жека'
            }))
            expect(store.messengers.listMessages('default', 'telegram:user:9')[0]?.senderName).toBe('Бро')
            expect(store.messengers.listParticipants('default', 'telegram:user:9')[0]).toEqual(expect.objectContaining({
                name: 'Бро', sourceName: 'Telegram friend', customName: 'Бро'
            }))
        } finally {
            store.close()
        }
    })

    it('does not replace a full avatar with a stripped Telegram placeholder', () => {
        const store = new Store(':memory:')
        const fullAvatar = `data:image/jpeg;base64,${'a'.repeat(8_000)}`
        const strippedAvatar = `data:image/jpeg;base64,${'b'.repeat(200)}`
        try {
            store.messengers.upsertConversation('default', {
                ...conversation('user:8', true),
                avatarDataUrl: fullAvatar
            })
            store.messengers.upsertConversation('default', {
                ...conversation('user:8', true),
                avatarDataUrl: strippedAvatar
            })

            expect(store.messengers.getConversation('default', 'telegram:user:8')?.avatarDataUrl).toBe(fullAvatar)
        } finally {
            store.close()
        }
    })

    it('reconciles deleted messages and refreshes the conversation preview', () => {
        const store = new Store(':memory:')
        const first = {
            id: 'telegram:user:1:1', conversationId: 'telegram:user:1', providerMessageId: '1',
            senderId: 'user:1', senderName: 'Friend', direction: 'incoming' as const,
            text: 'first', createdAt: 1000, editedAt: null, media: []
        }
        const second = {
            ...first, id: 'telegram:user:1:2', providerMessageId: '2', text: 'second', createdAt: 2000
        }
        try {
            store.messengers.upsertConversation('one', conversation('user:1', true))
            store.messengers.upsertMessage('one', first)
            store.messengers.upsertMessage('one', second)

            store.messengers.reconcileMessageSnapshot('one', first.conversationId, [second])
            expect(store.messengers.listMessages('one', first.conversationId).map((item) => item.providerMessageId)).toEqual(['2'])
            expect(store.messengers.getConversation('one', first.conversationId)?.lastMessagePreview).toBe('second')

            expect(store.messengers.deleteMessages('one', 'telegram', ['2'])).toEqual([first.conversationId])
            expect(store.messengers.listMessages('one', first.conversationId)).toEqual([])
            expect(store.messengers.getConversation('one', first.conversationId)).toEqual(expect.objectContaining({
                lastMessageAt: null,
                lastMessagePreview: null
            }))
        } finally {
            store.close()
        }
    })

    it('marks outgoing messages and the conversation preview as read', () => {
        const store = new Store(':memory:')
        try {
            store.messengers.upsertConversation('one', conversation('user:1', true))
            for (const id of ['4', '5', '6']) {
                store.messengers.upsertMessage('one', {
                    id: `telegram:user:1:${id}`,
                    conversationId: 'telegram:user:1',
                    providerMessageId: id,
                    senderId: 'user:me',
                    senderName: 'Me',
                    direction: 'outgoing',
                    deliveryStatus: 'sent',
                    text: id,
                    createdAt: Number(id),
                    editedAt: null,
                    media: []
                })
            }

            store.messengers.markOutgoingMessagesRead('one', 'telegram:user:1', 5)

            expect(store.messengers.listMessages('one', 'telegram:user:1').map((message) => message.deliveryStatus))
                .toEqual(['read', 'read', 'sent'])
            expect(store.messengers.getConversation('one', 'telegram:user:1')).toEqual(expect.objectContaining({
                lastMessageDirection: 'outgoing',
                lastMessageDeliveryStatus: 'sent'
            }))
        } finally {
            store.close()
        }
    })

    it('does not rewind the preview when a stale chat-list snapshot arrives', () => {
        const store = new Store(':memory:')
        try {
            store.messengers.upsertConversation('one', {
                ...conversation('user:1', true),
                lastMessageAt: 5_000,
                lastMessagePreview: 'fresh message',
                lastMessageDirection: 'incoming'
            })

            // A later chat-list read whose payload trails the history sync must
            // not roll the row back to the older message.
            store.messengers.upsertConversation('one', {
                ...conversation('user:1', true),
                lastMessageAt: 3_000,
                lastMessagePreview: 'stale message',
                lastMessageDirection: 'outgoing',
                lastMessageDeliveryStatus: 'read'
            })
            expect(store.messengers.getConversation('one', 'telegram:user:1')).toEqual(expect.objectContaining({
                lastMessageAt: 5_000,
                lastMessagePreview: 'fresh message',
                lastMessageDirection: 'incoming'
            }))

            // A genuinely newer snapshot still advances the row.
            store.messengers.upsertConversation('one', {
                ...conversation('user:1', true),
                lastMessageAt: 6_000,
                lastMessagePreview: 'newer message',
                lastMessageDirection: 'outgoing',
                lastMessageDeliveryStatus: 'sent'
            })
            expect(store.messengers.getConversation('one', 'telegram:user:1')).toEqual(expect.objectContaining({
                lastMessageAt: 6_000,
                lastMessagePreview: 'newer message',
                lastMessageDirection: 'outgoing',
                lastMessageDeliveryStatus: 'sent'
            }))
        } finally {
            store.close()
        }
    })
})
