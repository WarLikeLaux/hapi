import { describe, expect, it } from 'vitest'
import {
    appendOptimisticExternalMessage,
    createOptimisticExternalMessage,
    getOptimisticExternalSender,
    isOptimisticExternalMessage,
    removeOptimisticExternalMessage
} from './optimisticExternalMessages'

describe('optimistic external messages', () => {
    it('adds an outgoing message immediately and can roll it back by id', () => {
        const message = createOptimisticExternalMessage({
            conversationId: 'telegram:user:1',
            clientId: 'client-1',
            text: 'Sent now',
            createdAt: 123
        })

        const optimistic = appendOptimisticExternalMessage(undefined, message)
        expect(optimistic.messages).toEqual([message])
        expect(isOptimisticExternalMessage(message)).toBe(true)
        expect(removeOptimisticExternalMessage(optimistic, message.id)?.messages).toEqual([])
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
