import type { ExternalMessage, ExternalMessagesResponse } from '@hapi/protocol/messengers'

const OPTIMISTIC_MESSAGE_PREFIX = 'optimistic:'

export function createOptimisticExternalMessage(input: {
    conversationId: string
    clientId: string
    text: string
    createdAt?: number
}): ExternalMessage {
    return {
        id: `${OPTIMISTIC_MESSAGE_PREFIX}${input.clientId}`,
        conversationId: input.conversationId,
        providerMessageId: `${OPTIMISTIC_MESSAGE_PREFIX}${input.clientId}`,
        senderId: null,
        senderName: null,
        direction: 'outgoing',
        text: input.text,
        createdAt: input.createdAt ?? Date.now(),
        editedAt: null,
        media: []
    }
}

export function isOptimisticExternalMessage(message: ExternalMessage): boolean {
    return message.id.startsWith(OPTIMISTIC_MESSAGE_PREFIX)
}

export function appendOptimisticExternalMessage(
    current: ExternalMessagesResponse | undefined,
    message: ExternalMessage
): ExternalMessagesResponse {
    return {
        messages: [...(current?.messages ?? []).filter((item) => item.id !== message.id), message],
        participants: current?.participants ?? []
    }
}

export function removeOptimisticExternalMessage(
    current: ExternalMessagesResponse | undefined,
    messageId: string
): ExternalMessagesResponse | undefined {
    if (!current) return current
    return {
        ...current,
        messages: current.messages.filter((message) => message.id !== messageId)
    }
}
