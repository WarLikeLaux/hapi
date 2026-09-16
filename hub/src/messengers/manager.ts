import { createHash } from 'node:crypto'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type {
    ConfigureTelegramRequest,
    ExternalConversation,
    ExternalMessage,
    MessengerConnection,
    SubmitMessengerAuthRequest
} from '@hapi/protocol'
import type { Store } from '../store'
import type { SSEManager } from '../sse/sseManager'
import { TelegramConnector } from './telegramConnector'
import type { MessengerConnector, MessengerConnectorEvent, MessengerConnectorFactory } from './types'

type StoredTelegramConfig = ConfigureTelegramRequest

export class MessengerManager {
    private readonly connectors = new Map<string, MessengerConnector>()
    private readonly factories = new Map<string, MessengerConnectorFactory>()
    private readonly messageSyncs = new Map<string, Promise<void>>()
    private readonly messageSyncedAt = new Map<string, number>()

    constructor(private readonly options: {
        dataDir: string
        store: Store
        sseManager: SSEManager
    }) {
        this.factories.set('telegram', (connectorOptions) => new TelegramConnector(connectorOptions))
    }

    registerConnectorFactory(provider: string, factory: MessengerConnectorFactory): void {
        if (!provider.trim()) throw new Error('Messenger provider is required')
        if (this.factories.has(provider)) throw new Error(`Messenger provider already exists: ${provider}`)
        this.factories.set(provider, factory)
    }

    async getConnections(namespace: string): Promise<MessengerConnection[]> {
        const connections: MessengerConnection[] = []
        for (const provider of this.factories.keys()) {
            const connector = await this.getOrCreate(namespace, provider)
            await this.startFromSavedConfig(namespace, connector)
            connections.push(connector.getConnection())
        }
        return connections
    }

    async configureTelegram(namespace: string, config: ConfigureTelegramRequest): Promise<MessengerConnection> {
        await this.saveTelegramConfig(namespace, config)
        const connector = await this.getOrCreate(namespace, 'telegram')
        await connector.configure(config)
        return connector.getConnection()
    }

    async submitAuth(namespace: string, provider: string, input: SubmitMessengerAuthRequest): Promise<MessengerConnection> {
        const connector = await this.requireConnector(namespace, provider)
        await connector.submitAuth(input)
        return connector.getConnection()
    }

    async listCandidates(namespace: string, provider: string): Promise<ExternalConversation[]> {
        const connector = await this.requireConnector(namespace, provider)
        const remote = await connector.listConversations()
        const candidates = remote.filter((conversation) => !(provider === 'telegram' && conversation.kind === 'channel'))
        const selectedConversations = this.options.store.messengers.listConversations(namespace)
            .filter((conversation) => conversation.provider === provider)
        const selectedIds = new Set(selectedConversations.map((conversation) => conversation.remoteId))
        for (const conversation of remote) {
            if (selectedIds.has(conversation.remoteId)) {
                this.options.store.messengers.upsertConversation(namespace, conversation)
            }
        }
        return candidates.map((conversation) => ({
            ...conversation,
            selected: selectedIds.has(conversation.remoteId)
        }))
    }

    listConversations(namespace: string): ExternalConversation[] {
        return this.options.store.messengers.listConversations(namespace, true)
    }

    async selectConversations(namespace: string, provider: string, remoteIds: string[]): Promise<ExternalConversation[]> {
        const connector = await this.requireConnector(namespace, provider)
        const remote = await connector.listConversations()
        const selectableIds = new Set(remote
            .filter((conversation) => !(provider === 'telegram' && conversation.kind === 'channel'))
            .map((conversation) => conversation.remoteId))
        const selectedIds = new Set(remoteIds.filter((remoteId) => selectableIds.has(remoteId)))
        for (const conversation of this.options.store.messengers.listConversations(namespace)) {
            if (conversation.provider === provider && conversation.kind === 'channel') {
                selectedIds.add(conversation.remoteId)
            }
        }
        for (const conversation of remote) {
            if (selectedIds.has(conversation.remoteId)) {
                this.options.store.messengers.upsertConversation(namespace, conversation)
            }
        }
        this.options.store.messengers.replaceSelection(namespace, provider, [...selectedIds])
        this.options.sseManager.broadcast({ type: 'external-conversation-updated', namespace, conversationId: '*' })
        return this.listConversations(namespace)
    }

    async listMessages(namespace: string, conversationId: string): Promise<ExternalMessage[]> {
        const conversation = this.options.store.messengers.getConversation(namespace, conversationId)
        if (!conversation?.selected) throw new Error('Conversation not found')
        const cached = this.options.store.messengers.listMessages(namespace, conversationId)
        const lastSyncAt = this.messageSyncedAt.get(this.key(namespace, conversationId)) ?? 0
        if (cached.length > 0) {
            if (Date.now() - lastSyncAt > 15_000) {
                void this.refreshMessages(namespace, conversation, 30, true).catch(() => {})
            }
            return cached
        }
        await this.refreshMessages(namespace, conversation, conversation.kind === 'channel' ? 100 : 30, false)
        return this.options.store.messengers.listMessages(namespace, conversationId)
    }

    async sendText(namespace: string, conversationId: string, text: string, clientId?: string): Promise<void> {
        const conversation = this.options.store.messengers.getConversation(namespace, conversationId)
        if (!conversation?.selected) throw new Error('Conversation not found')
        const connector = await this.requireConnector(namespace, conversation.provider)
        await connector.sendText(conversation.remoteId, text, clientId)
        await this.refreshMessages(namespace, conversation, 30, true)
    }

    async stop(): Promise<void> {
        await Promise.all(Array.from(this.connectors.values(), (connector) => connector.stop()))
        this.connectors.clear()
    }

    private key(namespace: string, provider: string): string {
        return `${namespace}\0${provider}`
    }

    private refreshMessages(
        namespace: string,
        conversation: ExternalConversation,
        limit: number,
        broadcast: boolean
    ): Promise<void> {
        const syncKey = this.key(namespace, conversation.id)
        const existing = this.messageSyncs.get(syncKey)
        if (existing) return existing
        const sync = (async () => {
            const connector = await this.requireConnector(namespace, conversation.provider)
            const messages = await connector.loadMessages(conversation.remoteId, limit)
            for (const message of messages) this.options.store.messengers.upsertMessage(namespace, message)
            this.messageSyncedAt.set(syncKey, Date.now())
            if (broadcast) {
                this.options.sseManager.broadcast({
                    type: 'external-message-received',
                    namespace,
                    conversationId: conversation.id
                })
            }
        })().finally(() => {
            this.messageSyncs.delete(syncKey)
        })
        this.messageSyncs.set(syncKey, sync)
        return sync
    }

    private namespaceDir(namespace: string, provider: string): string {
        const namespaceHash = createHash('sha256').update(namespace).digest('hex').slice(0, 24)
        return join(this.options.dataDir, 'messengers', namespaceHash, provider)
    }

    private async getOrCreate(namespace: string, provider: string): Promise<MessengerConnector> {
        const key = this.key(namespace, provider)
        const existing = this.connectors.get(key)
        if (existing) return existing
        const factory = this.factories.get(provider)
        if (!factory) throw new Error(`Unsupported messenger provider: ${provider}`)
        const dataDir = this.namespaceDir(namespace, provider)
        await mkdir(dataDir, { recursive: true, mode: 0o700 })
        await chmod(dataDir, 0o700).catch(() => {})
        const connector = factory({
            namespace,
            dataDir,
            onEvent: (event) => this.handleEvent(namespace, event)
        })
        this.connectors.set(key, connector)
        return connector
    }

    private async requireConnector(namespace: string, provider: string): Promise<MessengerConnector> {
        const connector = await this.getOrCreate(namespace, provider)
        await this.startFromSavedConfig(namespace, connector)
        if (connector.getConnection().state === 'unconfigured') {
            throw new Error(`${provider} is not configured`)
        }
        return connector
    }

    private async startFromSavedConfig(namespace: string, connector: MessengerConnector): Promise<void> {
        if (connector.getConnection().state !== 'unconfigured') return
        if (connector.provider !== 'telegram') return
        const config = await this.readTelegramConfig(namespace)
        if (!config) return
        try {
            await connector.configure(config)
        } catch (error) {
            console.error('[Messengers] Failed to start Telegram connector:', error)
        }
    }

    private async saveTelegramConfig(namespace: string, config: StoredTelegramConfig): Promise<void> {
        const dir = this.namespaceDir(namespace, 'telegram')
        await mkdir(dir, { recursive: true, mode: 0o700 })
        const path = join(dir, 'config.json')
        await writeFile(path, `${JSON.stringify(config)}\n`, { mode: 0o600 })
        await chmod(path, 0o600).catch(() => {})
    }

    private async readTelegramConfig(namespace: string): Promise<StoredTelegramConfig | null> {
        try {
            const raw = await readFile(join(this.namespaceDir(namespace, 'telegram'), 'config.json'), 'utf8')
            const value = JSON.parse(raw) as Partial<StoredTelegramConfig>
            if (!Number.isInteger(value.apiId) || !value.apiHash) return null
            return { apiId: value.apiId as number, apiHash: value.apiHash }
        } catch {
            return null
        }
    }

    private handleEvent(namespace: string, event: MessengerConnectorEvent): void {
        if (event.type === 'connection') {
            this.options.sseManager.broadcast({
                type: 'messenger-connection-updated',
                namespace,
                provider: event.connection.provider
            })
            return
        }
        if (event.type === 'conversation') {
            const existing = this.options.store.messengers.getConversation(namespace, event.conversation.id)
            this.options.store.messengers.upsertConversation(namespace, {
                ...event.conversation,
                selected: existing?.selected ?? event.conversation.selected
            })
            this.options.sseManager.broadcast({
                type: 'external-conversation-updated',
                namespace,
                conversationId: event.conversation.id
            })
            return
        }
        const conversation = this.options.store.messengers.getConversation(namespace, event.message.conversationId)
        if (!conversation?.selected) return
        this.options.store.messengers.upsertMessage(namespace, event.message)
        this.options.sseManager.broadcast({
            type: 'external-message-received',
            namespace,
            conversationId: event.message.conversationId
        })
    }
}
