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

export interface MessengerConnector {
    readonly provider: string
    getConnection(): MessengerConnection
    configure(config: unknown): Promise<void>
    submitAuth(input: SubmitMessengerAuthRequest): Promise<void>
    listConversations(): Promise<ExternalConversation[]>
    loadMessages(remoteId: string, limit?: number): Promise<ExternalMessage[]>
    sendText(remoteId: string, text: string, clientId?: string): Promise<void>
    stop(): Promise<void>
}

export type MessengerConnectorFactory = (options: {
    namespace: string
    dataDir: string
    onEvent: (event: MessengerConnectorEvent) => void
}) => MessengerConnector
