import type {
    ExternalConversation,
    ExternalMessage,
    ExternalReaction,
    MessengerConnection,
    SendExternalStickerRequest,
    SubmitMessengerAuthRequest
} from '@hapi/protocol'

export type MessengerConnectorEvent =
    | { type: 'connection'; connection: MessengerConnection }
    | { type: 'conversation'; conversation: ExternalConversation }
    | { type: 'message'; message: ExternalMessage }
    | { type: 'messages-deleted'; provider: string; remoteId?: string; providerMessageIds: string[] }
    | { type: 'messages-read'; provider: string; remoteId: string; maxProviderMessageId: number }
    | { type: 'inbox-read'; provider: string; remoteId: string; unreadCount: number }
    | { type: 'message-reactions'; provider: string; remoteId: string; providerMessageId: string; reactions: ExternalReaction[] }

export type DownloadedExternalMedia = {
    path: string
    mimeType: string
    fileName: string
    size: number
}

export type SendExternalMediaInput = {
    path: string
    fileName: string
    mimeType: string
    caption: string
    clientId?: string
    /** Send the media as a reply to this provider message id (providers that support replies). */
    replyToProviderMessageId?: string
}

export interface MessengerConnector {
    readonly provider: string
    getConnection(): MessengerConnection
    configure(config: unknown): Promise<void>
    submitAuth(input: SubmitMessengerAuthRequest): Promise<void>
    listConversations(): Promise<ExternalConversation[]>
    loadMessages(remoteId: string, limit?: number): Promise<ExternalMessage[]>
    markRead?(
        remoteId: string,
        maxProviderMessageId: number,
        /**
         * Provider-specific read-receipt cursor. For chats-web the `SeenMarker`
         * mutation is durably accepted only when `seqNo` and `version` match the
         * `ServerMessageInfo` of the message being marked read. Providers that
         * do not need a cursor (e.g. Telegram, where the connector itself
         * resolves seq numbers from the API) should ignore the extra fields.
         */
        cursor?: { seqNo: number; version: number }
    ): Promise<void>
    downloadMedia(remoteId: string, providerMessageId: string, mediaIndex: number): Promise<DownloadedExternalMedia>
    sendText(
        remoteId: string,
        text: string,
        clientId?: string,
        /** Provider message id to send this message as a reply to. */
        replyToProviderMessageId?: string
    ): Promise<void>
    setReactions(remoteId: string, providerMessageId: string, reactions: string[]): Promise<void>
    /**
     * Presses a bot inline-keyboard button. `kind: 'url'` buttons never reach
     * the connector (the web opens those directly); this only handles callback
     * buttons. Returns the provider's optional alert text shown after the press.
     */
    pressButton?(remoteId: string, providerMessageId: string, buttonId: string): Promise<{ message: string | null }>
    sendMedia(remoteId: string, input: SendExternalMediaInput): Promise<void>
    sendSticker?(remoteId: string, input: SendExternalStickerRequest): Promise<void>
    stop(): Promise<void>
}

export type MessengerConnectorFactory = (options: {
    namespace: string
    dataDir: string
    onEvent: (event: MessengerConnectorEvent) => void
    /**
     * Optional hook called by the connector when it observes an avatar on the
     * wire that the chat-list payload did not carry (typical for direct chats
     * where `PartnerInfo.AvatarId` is missing in the binary WS payload). The
     * manager uses it to backfill `conversation.avatarDataUrl` without
     * overwriting an existing URL.
     */
    backfillConversationAvatar?: (remoteId: string, avatarDataUrl: string) => void
}) => MessengerConnector
