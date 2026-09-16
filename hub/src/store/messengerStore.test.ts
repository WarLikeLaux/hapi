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
    it('keeps selection and cached messages isolated by namespace', () => {
        const store = new Store(':memory:')
        try {
            store.messengers.upsertConversation('one', conversation('user:1', false))
            store.messengers.upsertConversation('one', conversation('user:2', false))
            store.messengers.upsertConversation('two', conversation('user:1', false))
            store.messengers.replaceSelection('one', 'telegram', ['user:1'])

            const selected = store.messengers.listConversations('one')
            expect(selected.map((item) => item.remoteId)).toEqual(['user:1'])
            expect(store.messengers.listConversations('one', false).map((item) => item.remoteId)).toEqual(['user:1'])
            expect(store.messengers.listConversations('two')).toEqual([])

            store.messengers.upsertMessage('one', {
                id: 'telegram:user:1:5',
                conversationId: 'telegram:user:1',
                providerMessageId: '5',
                senderId: 'user:1',
                senderName: 'Friend',
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
                }]
            })
            expect(store.messengers.listMessages('one', 'telegram:user:1')).toEqual([
                expect.objectContaining({ media: [expect.objectContaining({ kind: 'image', size: 128 })] })
            ])
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
})
