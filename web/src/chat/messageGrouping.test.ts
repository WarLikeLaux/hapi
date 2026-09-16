import { describe, expect, it } from 'vitest'
import type { ExternalMessage } from '@hapi/protocol'
import { areExternalMessagesGrouped } from './messageGrouping'

function message(overrides: Partial<ExternalMessage> = {}): ExternalMessage {
    return {
        id: 'message-1',
        conversationId: 'telegram:group:1',
        providerMessageId: '1',
        senderId: 'user:1',
        senderName: 'Alice',
        direction: 'incoming',
        text: 'Hello',
        createdAt: new Date(2026, 8, 17, 12, 0).getTime(),
        editedAt: null,
        ...overrides,
    }
}

describe('areExternalMessagesGrouped', () => {
    it('groups consecutive messages from the same author', () => {
        const previous = message()
        const current = message({ id: 'message-2', createdAt: previous.createdAt + 30_000 })

        expect(areExternalMessagesGrouped(previous, current)).toBe(true)
    })

    it('starts a new group when the author or direction changes', () => {
        const previous = message()

        expect(areExternalMessagesGrouped(previous, message({ senderId: 'user:2' }))).toBe(false)
        expect(areExternalMessagesGrouped(previous, message({ direction: 'outgoing' }))).toBe(false)
    })

    it('keeps the same author grouped after a long pause', () => {
        const previous = message()

        expect(areExternalMessagesGrouped(previous, message({
            createdAt: previous.createdAt + (6 * 60 * 60 * 1000),
        }))).toBe(true)
    })

    it('starts a new group at a day boundary', () => {
        expect(areExternalMessagesGrouped(
            message({ createdAt: new Date(2026, 8, 16, 23, 59).getTime() }),
            message({ createdAt: new Date(2026, 8, 17, 0, 0).getTime() })
        )).toBe(false)
    })
})
