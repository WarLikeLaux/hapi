import type { ExternalMessage, ExternalMessagesResponse } from '@hapi/protocol/messengers'

const OPTIMISTIC_MESSAGE_PREFIX = 'optimistic:'

export function createOptimisticExternalMessage(input: {
    conversationId: string
    clientId: string
    text: string
    createdAt?: number
    senderId?: string | null
    senderName?: string | null
    senderAvatarDataUrl?: string | null
}): ExternalMessage {
    return {
        id: `${OPTIMISTIC_MESSAGE_PREFIX}${input.clientId}`,
        conversationId: input.conversationId,
        providerMessageId: `${OPTIMISTIC_MESSAGE_PREFIX}${input.clientId}`,
        senderId: input.senderId ?? null,
        senderName: input.senderName ?? null,
        senderAvatarDataUrl: input.senderAvatarDataUrl ?? null,
        direction: 'outgoing',
        text: input.text,
        createdAt: input.createdAt ?? Date.now(),
        editedAt: null,
        media: []
    }
}

export function getOptimisticExternalSender(
    current: ExternalMessagesResponse | undefined
): Pick<ExternalMessage, 'senderId' | 'senderName' | 'senderAvatarDataUrl'> {
    const messages = current?.messages ?? []
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index]
        if (message?.direction !== 'outgoing' || isOptimisticExternalMessage(message)) continue
        return {
            senderId: message.senderId,
            senderName: message.senderName,
            senderAvatarDataUrl: message.senderAvatarDataUrl ?? null
        }
    }
    return { senderId: null, senderName: null, senderAvatarDataUrl: null }
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
