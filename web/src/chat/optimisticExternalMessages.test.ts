import { describe, expect, it } from 'vitest'
import {
    createOptimisticExternalMessage,
    getOptimisticExternalSender,
    isOptimisticExternalMessage
} from './optimisticExternalMessages'

describe('optimistic external messages', () => {
    it('creates an outgoing message with a client identity', () => {
        const message = createOptimisticExternalMessage({
            conversationId: 'telegram:user:1',
            clientId: 'client-1',
            text: 'Sent now',
            createdAt: 123
        })

        expect(message).toMatchObject({
            id: 'optimistic:client-1', conversationId: 'telegram:user:1',
            direction: 'outgoing', text: 'Sent now', createdAt: 123,
        })
        expect(isOptimisticExternalMessage(message)).toBe(true)
    })

    it('carries the reply target on the optimistic message', () => {
        const message = createOptimisticExternalMessage({
            conversationId: 'telegram:user:1',
            clientId: 'client-3',
            text: 'Answer',
            replyToProviderMessageId: '7'
        })

        expect(message.replyToProviderMessageId).toBe('7')
    })

    it('reuses the known current-user identity for a new optimistic message', () => {
        const current = {
            messages: [{
                id: 'telegram:user:1:42',
                conversationId: 'telegram:user:1',
                providerMessageId: '42',
                senderId: 'user:me',
                senderName: 'Me',
                senderAvatarDataUrl: 'data:image/jpeg;base64,avatar',
                direction: 'outgoing' as const,
                text: 'Previous',
                createdAt: 100,
                editedAt: null,
                media: []
            }],
            participants: []
        }

        const message = createOptimisticExternalMessage({
            conversationId: 'telegram:user:1',
            clientId: 'client-2',
            text: 'Sending',
            ...getOptimisticExternalSender(current)
        })

        expect(message).toMatchObject({
            senderId: 'user:me',
            senderName: 'Me',
            senderAvatarDataUrl: 'data:image/jpeg;base64,avatar'
        })
    })
})
