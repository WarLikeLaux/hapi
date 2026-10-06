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
    detail: z.string().nullable(),
    /**
     * Resolved avatar URL for the currently logged-in account on this
     * provider (not the partner avatars). Optional - providers that cannot
     * resolve the own account's avatar (or that have no avatar configured)
     * return null. UIs may use this to label outgoing messages / settings.
     */
    accountAvatarUrl: z.string().nullable().optional()
})
export type MessengerConnection = z.infer<typeof MessengerConnectionSchema>

export const ExternalConversationKindSchema = z.enum(['direct', 'group', 'channel', 'saved'])
export type ExternalConversationKind = z.infer<typeof ExternalConversationKindSchema>

export const ExternalMessageDeliveryStatusSchema = z.enum(['sent', 'read'])
export type ExternalMessageDeliveryStatus = z.infer<typeof ExternalMessageDeliveryStatusSchema>

export const ExternalConversationSchema = z.object({
    id: z.string().min(1),
    provider: MessengerProviderSchema,
    remoteId: z.string().min(1),
    title: z.string().min(1),
    sourceTitle: z.string().min(1).optional(),
    customTitle: z.string().nullable().optional(),
    kind: ExternalConversationKindSchema,
    selected: z.boolean(),
    lastMessageAt: z.number().int().nullable(),
    lastMessagePreview: z.string().nullable(),
    lastMessageDirection: z.enum(['incoming', 'outgoing']).nullable().optional(),
    lastMessageDeliveryStatus: ExternalMessageDeliveryStatusSchema.nullable().optional(),
    unreadCount: z.number().int().nonnegative(),
    avatarDataUrl: z.string().nullable().optional()
})
export type ExternalConversation = z.infer<typeof ExternalConversationSchema>

export const ExternalMediaKindSchema = z.enum([
    'image',
    'video',
    'audio',
    'voice',
    'sticker',
    'file',
    'location',
    'contact',
    'poll',
    'other'
])
export type ExternalMediaKind = z.infer<typeof ExternalMediaKindSchema>

export const ExternalMediaSchema = z.object({
    kind: ExternalMediaKindSchema,
    mimeType: z.string().nullable(),
    fileName: z.string().nullable(),
    size: z.number().int().nonnegative().nullable(),
    thumbnailDataUrl: z.string().nullable(),
    isRound: z.boolean().optional(),
    isAnimated: z.boolean().optional()
})
export type ExternalMedia = z.infer<typeof ExternalMediaSchema>

export const ExternalReactionSchema = z.object({
    reaction: z.string().min(1),
    emoji: z.string().nullable(),
    count: z.number().int().positive(),
    chosen: z.boolean()
})
export type ExternalReaction = z.infer<typeof ExternalReactionSchema>

/**
 * A single bot inline-keyboard button. `kind: 'url'` buttons carry an absolute
 * `url` the client opens directly; `kind: 'callback'` buttons are pressed
 * through the hub, and the provider resolves the callback payload server-side
 * (the wire only carries the button's position id).
 */
export const ExternalMessageButtonSchema = z.object({
    id: z.string().min(1).max(64),
    text: z.string().min(1).max(256),
    kind: z.enum(['callback', 'url']),
    url: z.string().max(2048).optional()
})
export type ExternalMessageButton = z.infer<typeof ExternalMessageButtonSchema>

export const ExternalMessageSchema = z.object({
    id: z.string().min(1),
    conversationId: z.string().min(1),
    providerMessageId: z.string().min(1),
    senderId: z.string().nullable(),
    senderName: z.string().nullable(),
    senderAvatarDataUrl: z.string().nullable().optional(),
    direction: z.enum(['incoming', 'outgoing']),
    text: z.string(),
    createdAt: z.number().int(),
    editedAt: z.number().int().nullable(),
    deliveryStatus: ExternalMessageDeliveryStatusSchema.optional(),
    media: z.array(ExternalMediaSchema).optional(),
    reactions: z.array(ExternalReactionSchema).optional(),
    /**
     * Bot inline-keyboard buttons grouped into rows as the provider laid them
     * out. Present only on messages the provider rendered with an inline
     * keyboard.
     */
    buttons: z.array(z.array(ExternalMessageButtonSchema).max(8)).max(10).optional(),
    /**
     * Provider-specific chat-local sequence number. The chats-web protocol uses this
     * (not a timestamp) for read-receipt ordering — `SeenMarker` requires `SeqNo`
     * and a matching `Version` to be durably accepted. Carried on the wire but
     * optional in this contract so providers that do not expose it can omit it.
     */
    seqNo: z.number().int().nonnegative().optional(),
    /**
     * Monotonic per-message version that bumps on edit/delete. Required alongside
     * `seqNo` for `SeenMarker` in chats-web.
     */
    version: z.number().int().nonnegative().optional()
})
export type ExternalMessage = z.infer<typeof ExternalMessageSchema>

export const ExternalParticipantSchema = z.object({
    id: z.string().min(1),
    name: z.string().nullable(),
    sourceName: z.string().nullable().optional(),
    customName: z.string().nullable().optional(),
    avatarDataUrl: z.string().nullable()
})
export type ExternalParticipant = z.infer<typeof ExternalParticipantSchema>

export const ConfigureTelegramRequestSchema = z.object({
    apiId: z.number().int().positive(),
    apiHash: z.string().trim().min(1),
})
export type ConfigureTelegramRequest = z.infer<typeof ConfigureTelegramRequestSchema>

// Personal Yandex Messenger has no public API: the connector talks the reverse-engineered
// chats-web protocol (registry HTTP + xiva WebSocket) authorized by session cookies.
export const ConfigureYandexRequestSchema = z.object({
    cookies: z.string().trim().min(1).max(16384),
})
export type ConfigureYandexRequest = z.infer<typeof ConfigureYandexRequestSchema>

export const SubmitMessengerAuthRequestSchema = z.object({
    kind: z.enum(['phone', 'code', 'password']),
    value: z.string().min(1)
})
export type SubmitMessengerAuthRequest = z.infer<typeof SubmitMessengerAuthRequestSchema>

export const SelectMessengerConversationsRequestSchema = z.object({
    remoteIds: z.array(z.string().min(1)).max(100)
})
export type SelectMessengerConversationsRequest = z.infer<typeof SelectMessengerConversationsRequestSchema>

export const UpdateExternalAliasRequestSchema = z.object({
    name: z.string().trim().min(1).max(128).nullable()
})
export type UpdateExternalAliasRequest = z.infer<typeof UpdateExternalAliasRequestSchema>

export const SendExternalMessageRequestSchema = z.object({
    text: z.string().trim().min(1).max(4096),
    clientId: z.string().min(1).max(128).optional()
})
export type SendExternalMessageRequest = z.infer<typeof SendExternalMessageRequestSchema>

export const SetExternalReactionsRequestSchema = z.object({
    reactions: z.array(z.string().min(1).max(128)).max(3)
})
export type SetExternalReactionsRequest = z.infer<typeof SetExternalReactionsRequestSchema>

export const PressExternalMessageButtonRequestSchema = z.object({
    buttonId: z.string().min(1).max(64)
})
export type PressExternalMessageButtonRequest = z.infer<typeof PressExternalMessageButtonRequestSchema>

export type PressExternalMessageButtonResponse = { ok: true; message: string | null }

export type MessengerConnectionsResponse = { connections: MessengerConnection[] }
export type ExternalConversationsResponse = { conversations: ExternalConversation[] }
export type ExternalMessagesResponse = {
    messages: ExternalMessage[]
    participants: ExternalParticipant[]
}
