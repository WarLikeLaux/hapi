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
                editedAt: null
            })
            expect(store.messengers.listMessages('one', 'telegram:user:1')).toHaveLength(1)
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
                title: 'Updated title'
            })
            expect(store.messengers.listConversations('default')).toEqual([
                expect.objectContaining({ title: 'Updated title', selected: true })
            ])
        } finally {
            store.close()
        }
    })
})
