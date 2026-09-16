import type {
    ExternalConversation,
    ExternalMessage,
    MessengerConnection,
    SubmitMessengerAuthRequest
} from '@hapi/protocol'

export type MessengerConnectorEvent =
    | { type: 'connection'; connection: MessengerConnection }
    | { type: 'conversation'; conversation: ExternalConversation }
    | { type: 'message'; message: ExternalMessage }
    | { type: 'messages-deleted'; provider: string; remoteId?: string; providerMessageIds: string[] }
    | { type: 'messages-read'; provider: string; remoteId: string; maxProviderMessageId: number }

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
}

export interface MessengerConnector {
    readonly provider: string
    getConnection(): MessengerConnection
    configure(config: unknown): Promise<void>
    submitAuth(input: SubmitMessengerAuthRequest): Promise<void>
    listConversations(): Promise<ExternalConversation[]>
    loadMessages(remoteId: string, limit?: number): Promise<ExternalMessage[]>
    downloadMedia(remoteId: string, providerMessageId: string, mediaIndex: number): Promise<DownloadedExternalMedia>
    sendText(remoteId: string, text: string, clientId?: string): Promise<void>
    sendMedia(remoteId: string, input: SendExternalMediaInput): Promise<void>
    stop(): Promise<void>
}

export type MessengerConnectorFactory = (options: {
    namespace: string
    dataDir: string
    onEvent: (event: MessengerConnectorEvent) => void
}) => MessengerConnector
