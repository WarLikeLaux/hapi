import { z } from 'zod'

export const MessengerProviderSchema = z.string().min(1).max(64)
export type MessengerProvider = z.infer<typeof MessengerProviderSchema>

export const MessengerConnectionStateSchema = z.enum([
    'unconfigured',
    'starting',
    'awaiting_phone',
    'awaiting_code',
    'awaiting_password',
    'ready',
    'error',
    'unavailable'
])
export type MessengerConnectionState = z.infer<typeof MessengerConnectionStateSchema>

export const MessengerConnectionSchema = z.object({
    provider: MessengerProviderSchema,
    state: MessengerConnectionStateSchema,
    accountLabel: z.string().nullable(),
    detail: z.string().nullable()
})
export type MessengerConnection = z.infer<typeof MessengerConnectionSchema>

export const ExternalConversationKindSchema = z.enum(['direct', 'group', 'channel', 'saved'])
export type ExternalConversationKind = z.infer<typeof ExternalConversationKindSchema>

export const ExternalConversationSchema = z.object({
    id: z.string().min(1),
    provider: MessengerProviderSchema,
    remoteId: z.string().min(1),
    title: z.string().min(1),
    kind: ExternalConversationKindSchema,
    selected: z.boolean(),
    lastMessageAt: z.number().int().nullable(),
    lastMessagePreview: z.string().nullable(),
    unreadCount: z.number().int().nonnegative()
})
export type ExternalConversation = z.infer<typeof ExternalConversationSchema>

export const ExternalMessageSchema = z.object({
    id: z.string().min(1),
    conversationId: z.string().min(1),
    providerMessageId: z.string().min(1),
    senderId: z.string().nullable(),
    senderName: z.string().nullable(),
    direction: z.enum(['incoming', 'outgoing']),
    text: z.string(),
    createdAt: z.number().int(),
    editedAt: z.number().int().nullable()
})
export type ExternalMessage = z.infer<typeof ExternalMessageSchema>

export const ConfigureTelegramRequestSchema = z.object({
    apiId: z.number().int().positive(),
    apiHash: z.string().trim().min(1),
})
export type ConfigureTelegramRequest = z.infer<typeof ConfigureTelegramRequestSchema>

export const SubmitMessengerAuthRequestSchema = z.object({
    kind: z.enum(['phone', 'code', 'password']),
    value: z.string().min(1)
})
export type SubmitMessengerAuthRequest = z.infer<typeof SubmitMessengerAuthRequestSchema>

export const SelectMessengerConversationsRequestSchema = z.object({
    remoteIds: z.array(z.string().min(1)).max(100)
})
export type SelectMessengerConversationsRequest = z.infer<typeof SelectMessengerConversationsRequestSchema>

export const SendExternalMessageRequestSchema = z.object({
    text: z.string().trim().min(1).max(4096),
    clientId: z.string().min(1).max(128).optional()
})
export type SendExternalMessageRequest = z.infer<typeof SendExternalMessageRequestSchema>

export type MessengerConnectionsResponse = { connections: MessengerConnection[] }
export type ExternalConversationsResponse = { conversations: ExternalConversation[] }
export type ExternalMessagesResponse = { messages: ExternalMessage[] }
