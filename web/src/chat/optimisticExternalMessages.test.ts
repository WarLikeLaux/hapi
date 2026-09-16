import { describe, expect, it } from 'vitest'
import {
    appendOptimisticExternalMessage,
    createOptimisticExternalMessage,
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
})
