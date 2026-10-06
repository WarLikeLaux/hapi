import { createHash, randomUUID } from 'node:crypto'
import { chmod, mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import type {
    ConfigureTelegramRequest,
    ConfigureYandexRequest,
    ExternalConversation,
    ExternalMessage,
    ExternalParticipant,
    MessengerConnection,
    SubmitMessengerAuthRequest
} from '@hapi/protocol'
import type { Store } from '../store'
import type { SSEManager } from '../sse/sseManager'
import { TelegramConnector } from './telegramConnector'
import { YandexConnector } from './yandex/yandexConnector'
import type { DownloadedExternalMedia, MessengerConnector, MessengerConnectorEvent, MessengerConnectorFactory } from './types'

type MediaPrefetchTask = {
    key: string
    namespace: string
    conversation: ExternalConversation
    providerMessageId: string
    mediaIndex: number
}

const MAX_PREFETCH_MEDIA_BYTES = 25 * 1024 * 1024
// Background Telegram downloads must stay deliberately slow. Bursting through a
// freshly populated queue can trip account-wide FLOOD_WAIT and block user sends.
const MEDIA_PREFETCH_INTERVAL_MS = 2_000
const FLOOD_WAIT_GRACE_MS = 1_000
const CANDIDATE_REFRESH_INTERVAL_MS = 60_000
// Lazy avatar enrichment on /conversations hits Yandex with a `get_users` batch
// per missing-avatar chat. Keep this comfortably larger than the candidate
// interval so a refresh through the candidates UI is not immediately shadowed
// by a refresh kicked off by the chat list.
const AVATAR_LAZY_REFRESH_INTERVAL_MS = 5 * 60_000

/**
 * Rewrite yapic avatar URLs that point at dead (`/SMALL48`) or too-small
 * (`/islands-small`) sizes when they reach the API surface. `/islands-200`
 * (200x200 JPEG, ~11 KB) is small enough for chat chips and crisp on retina.
 * We do not touch the DB row: the same component writes correct URLs on the
 * next refresh, but until then the read path stays consistent so the UI does
 * not flash old URLs.
 */
function repairAvatarUrl(conversation: ExternalConversation): ExternalConversation {
    const url = conversation.avatarDataUrl
    if (typeof url !== 'string') return conversation
    if (!url.includes('avatars.mds.yandex.net')) return conversation
    if (url.includes('/islands-200')) return conversation
    let next = url
    if (next.includes('/SMALL48')) next = next.replace(/\/SMALL48(?=$|\?)/, '/islands-200')
    if (next.includes('/islands-small')) next = next.replace(/\/islands-small(?=$|\?)/, '/islands-200')
    if (next === url) return conversation
    return { ...conversation, avatarDataUrl: next }
}

function getFloodWaitMs(error: unknown): number | null {
    const message = error instanceof Error ? error.message : String(error)
    const match = message.match(/FLOOD_WAIT\s*\((\d+)\)/i)
    if (!match) return null
    const seconds = Number.parseInt(match[1], 10)
    return Number.isFinite(seconds) ? (seconds * 1_000) + FLOOD_WAIT_GRACE_MS : null
}

export class MessengerManager {
    private readonly connectors = new Map<string, MessengerConnector>()
    private readonly factories = new Map<string, MessengerConnectorFactory>()
    private readonly messageSyncs = new Map<string, Promise<void>>()
    private readonly messageSyncedAt = new Map<string, number>()
    private readonly candidateSyncs = new Map<string, Promise<void>>()
    private readonly candidateSyncedAt = new Map<string, number>()
    private readonly mediaDownloads = new Map<string, Promise<DownloadedExternalMedia>>()
    private readonly mediaPrefetchQueued = new Set<string>()
    private readonly mediaPrefetchQueue: MediaPrefetchTask[] = []
    private readonly mediaPrefetchPausedUntil = new Map<string, number>()
    private readonly avatarLazyRefreshAt = new Map<string, number>()
    private mediaPrefetchRunning = false
    /**
     * Conversations the operator currently has open in the web UI. Keyed by
     * `<namespace>:<conversationId>` so a single namespace can host several
     * messengers side by side. Used to drive real-time SeenMarker pushes on
     * incoming messages and to keep peer read-receipt cursors fresh in the
     * open chat as soon as the connector's sync handler delivers them.
     */
    private readonly openConversations = new Set<string>()
    private stopped = false

    constructor(private readonly options: {
        dataDir: string
        store: Store
        sseManager: SSEManager
    }) {
        this.factories.set('telegram', (connectorOptions) => new TelegramConnector(connectorOptions))
        this.factories.set('yandex', (connectorOptions) => new YandexConnector(connectorOptions))
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
        await this.saveProviderConfig(namespace, 'telegram', config)
        const connector = await this.getOrCreate(namespace, 'telegram')
        await connector.configure(config)
        return connector.getConnection()
    }

    async configureYandex(namespace: string, config: ConfigureYandexRequest): Promise<MessengerConnection> {
        await this.saveProviderConfig(namespace, 'yandex', config)
        const connector = await this.getOrCreate(namespace, 'yandex')
        await connector.configure(config)
        return connector.getConnection()
    }

    async submitAuth(namespace: string, provider: string, input: SubmitMessengerAuthRequest): Promise<MessengerConnection> {
        const connector = await this.requireConnector(namespace, provider)
        await connector.submitAuth(input)
        return connector.getConnection()
    }

    async listCandidates(namespace: string, provider: string, forceRefresh = false): Promise<ExternalConversation[]> {
        const cached = this.cachedCandidates(namespace, provider)
        const syncKey = this.key(namespace, provider)
        const initialized = this.candidateSyncedAt.has(syncKey)
        if (forceRefresh) {
            await this.refreshCandidates(namespace, provider)
        } else if (initialized && Date.now() - (this.candidateSyncedAt.get(syncKey) ?? 0) > CANDIDATE_REFRESH_INTERVAL_MS) {
            // Already populated once - keep it fresh in the background.
            void this.refreshCandidates(namespace, provider).catch((error) => {
                console.error(`[Messengers] Failed to refresh ${provider} conversations:`, error)
            })
        }
        // Default: never refreshed yet, or caller opted out. Return whatever
        // is already in the store without hitting the provider's WS.
        return this.cachedCandidates(namespace, provider)
    }

    listConversations(namespace: string): ExternalConversation[] {
        const conversations = this.options.store.messengers.listConversations(namespace, true)
        this.maybeLazyRefreshAvatars(namespace, conversations)
        return conversations.map(repairAvatarUrl)
    }

    /**
     * Background fallback for chat-list avatars that did not arrive via the
     * binary `history` payload. When a Yandex direct/saved conversation is
     * still missing an `avatarDataUrl` after a successful chat-list read, kick
     * off a throttled refresh so the next reload of `/conversations` already
     * has the URLs persisted. Errors and absent providers are no-ops; the chat
     * list keeps rendering with the initials fallback in the meantime.
     *
     * `kind` may be stale in the DB (the binary WS payload no longer exposes
     * `PrivateChatInfo`), so we infer "this chat has a partner we can look up"
     * from the chat id shape (`<uuid>_<uuid>`) - the same gate format used by
     * the connector. Group chats use `0/<int>/<uuid>` ids and are skipped.
     */
    private hasMissingYandexAvatar(url: unknown): boolean {
        return typeof url !== 'string' || url.length === 0
    }

    private maybeLazyRefreshAvatars(namespace: string, conversations: ExternalConversation[]): void {
        const gateFormat = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
        // Trigger a throttled refresh if a direct Yandex chat is still missing
        // an avatar. `normalizeAvatarUrl` rewrites `/SMALL48` on write so we
        // only need to chase truly empty entries here.
        const hasMissingYandexAvatar = conversations.some((conversation) =>
            conversation.provider === 'yandex'
            && this.hasMissingYandexAvatar(conversation.avatarDataUrl)
            && gateFormat.test(conversation.remoteId)
        )
        if (!hasMissingYandexAvatar) return
        const key = this.key(namespace, 'yandex')
        const last = this.avatarLazyRefreshAt.get(key) ?? 0
        if (Date.now() - last < AVATAR_LAZY_REFRESH_INTERVAL_MS) return
        this.avatarLazyRefreshAt.set(key, Date.now())
        void this.refreshCandidates(namespace, 'yandex').catch((error) => {
            console.error('[Messengers] Failed to lazy-refresh Yandex avatars:', error)
        })
    }

    listParticipants(namespace: string, conversationId: string): ExternalParticipant[] {
        return this.options.store.messengers.listParticipants(namespace, conversationId)
    }

    setConversationAlias(namespace: string, conversationId: string, name: string | null): ExternalConversation {
        const conversation = this.options.store.messengers.getConversation(namespace, conversationId)
        if (!conversation) throw new Error('Conversation not found')
        this.options.store.messengers.setConversationAlias(namespace, conversationId, name)
        this.options.sseManager.broadcast({ type: 'external-conversation-updated', namespace, conversationId })
        return this.options.store.messengers.getConversation(namespace, conversationId)!
    }

    setParticipantAlias(namespace: string, conversationId: string, participantId: string, name: string | null): ExternalParticipant {
        const conversation = this.options.store.messengers.getConversation(namespace, conversationId)
        if (!conversation) throw new Error('Conversation not found')
        this.options.store.messengers.setParticipantAlias(namespace, conversationId, participantId, name)
        this.options.sseManager.broadcast({ type: 'external-message-updated', namespace, conversationId })
        const participant = this.options.store.messengers.listParticipants(namespace, conversationId)
            .find((item) => item.id === participantId)
        if (!participant) throw new Error('Participant not found')
        return participant
    }

    async selectConversations(namespace: string, provider: string, remoteIds: string[]): Promise<ExternalConversation[]> {
        let remote = this.options.store.messengers.listConversations(namespace, false)
            .filter((conversation) => conversation.provider === provider)
        const cachedIds = new Set(remote.map((conversation) => conversation.remoteId))
        if (remote.length === 0 || remoteIds.some((remoteId) => !cachedIds.has(remoteId))) {
            await this.refreshCandidates(namespace, provider)
            remote = this.options.store.messengers.listConversations(namespace, false)
                .filter((conversation) => conversation.provider === provider)
        }
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
        void this.warmSelectedMessages(namespace, provider).catch((error) => {
            console.error('[Messengers] Failed to warm selected conversations:', error)
        })
        return this.listConversations(namespace)
    }

    private cachedCandidates(namespace: string, provider: string): ExternalConversation[] {
        return this.options.store.messengers.listConversations(namespace, false)
            .filter((conversation) => conversation.provider === provider)
            .filter((conversation) => !(provider === 'telegram' && conversation.kind === 'channel' && !conversation.selected))
    }

    private refreshCandidates(namespace: string, provider: string): Promise<void> {
        const syncKey = this.key(namespace, provider)
        const existing = this.candidateSyncs.get(syncKey)
        if (existing) return existing
        const sync = (async () => {
            const connector = await this.requireConnector(namespace, provider)
            const remote = await connector.listConversations()
            for (const conversation of remote) {
                this.options.store.messengers.upsertConversation(namespace, conversation)
            }
            this.candidateSyncedAt.set(syncKey, Date.now())
            this.options.sseManager.broadcast({
                type: 'external-conversation-updated',
                namespace,
                conversationId: '*'
            })
            // Kick off a per-conversation `loadMessages` for direct chats
            // whose avatar is still missing. The connector's
            // `maybeBackfillPartnerAvatar` reads `From.UserInfo.AvatarId`
            // and backfills the avatar via the registered callback.
            if (provider === 'yandex') this.backfillAvatarOnChatList(namespace)
        })().finally(() => {
            this.candidateSyncs.delete(syncKey)
        })
        this.candidateSyncs.set(syncKey, sync)
        return sync
    }

    /**
     * Background fan-out: for every selected Yandex direct chat that still
     * has no avatar in the store, ask the connector to fetch a fresh page
     * of messages. The connector's `maybeBackfillPartnerAvatar` reads the
     * sender's avatar from `From.UserInfo.AvatarId` and writes it via the
     * `backfillConversationAvatar` callback (the one already wired in
     * `getOrCreate`). Throttled per remote id so chat-list renders don't
     * pile up overlapping history requests.
     */
    private backfillAvatarOnChatList(namespace: string): void {
        const candidates = this.options.store.messengers.listConversations(namespace, true)
            .filter((conversation) => conversation.provider === 'yandex'
                && conversation.selected
                && !conversation.avatarDataUrl
                && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
                    .test(conversation.remoteId))
        if (candidates.length === 0) return
        const now = Date.now()
        for (const conversation of candidates) {
            const last = this.avatarLazyRefreshAt.get(`yandex-load:${conversation.remoteId}`) ?? 0
            if (now - last < AVATAR_LAZY_REFRESH_INTERVAL_MS) continue
            this.avatarLazyRefreshAt.set(`yandex-load:${conversation.remoteId}`, now)
            this.options.sseManager.broadcast({
                type: 'external-conversation-updated',
                namespace,
                conversationId: conversation.id
            })
            void (async () => {
                try {
                    const connector = await this.requireConnector(namespace, 'yandex')
                    await connector.loadMessages(conversation.remoteId, 20)
                } catch (error) {
                    console.error(`[Messengers] backfill failed for ${conversation.id}:`, error)
                }
            })()
        }
    }

    async listMessages(
        namespace: string,
        conversationId: string,
        options: { markRead?: boolean; refresh?: boolean } = {}
    ): Promise<ExternalMessage[]> {
        const conversation = this.options.store.messengers.getConversation(namespace, conversationId)
        if (!conversation?.selected) throw new Error('Conversation not found')
        const cached = this.options.store.messengers.listMessages(namespace, conversationId)
        if (options.markRead !== false) {
            // Always emit SeenMarker when the chat opens — the `unreadCount > 0`
            // gate used to leave a stale counter (e.g. another device already
            // drained it) so the peer never saw "read" for messages the user
            // actually opened. The connector ignores the push when the cursor
            // matches what's already on the server.
            this.options.store.messengers.setUnreadCount(namespace, conversationId, 0)
            this.options.sseManager.broadcast({ type: 'external-conversation-updated', namespace, conversationId })
            // chats-web requires `SeenMarker.SeqNo`/`Version` (not a timestamp) for
            // durable acceptance. Track the highest seqNo/version seen alongside the
            // provider message id; providers that ignore the cursor fall back to
            // `maxProviderMessageId` only.
            let maxProviderMessageId = 0
            let maxSeqNo: number | undefined
            let maxVersion: number | undefined
            for (const message of cached) {
                const id = Number(message.providerMessageId)
                if (Number.isSafeInteger(id) && id > maxProviderMessageId) {
                    maxProviderMessageId = id
                }
                if (message.seqNo !== undefined) {
                    if (maxSeqNo === undefined || message.seqNo > maxSeqNo) {
                        maxSeqNo = message.seqNo
                        // Pair the seqNo with the same message's version (1 when
                        // unedited) so the cursor describes a real ServerMessageInfo.
                        maxVersion = message.version ?? 1
                    }
                }
            }
            if (maxProviderMessageId > 0) {
                const connector = await this.requireConnector(namespace, conversation.provider)
                try {
                    const cursor = maxSeqNo !== undefined && maxVersion !== undefined
                        ? { seqNo: maxSeqNo, version: maxVersion }
                        : undefined
                    await connector.markRead?.(conversation.remoteId, maxProviderMessageId, cursor)
                } catch (error) {
                    console.error(`[Messengers] Failed to mark ${conversation.id} read:`, error)
                }
            }
        }
        const lastSyncAt = this.messageSyncedAt.get(this.key(namespace, conversationId)) ?? 0
        if (options.refresh !== false && (cached.length === 0 || Date.now() - lastSyncAt > 15_000)) {
            void this.refreshMessages(namespace, conversation, 100, true).catch((error) => {
                console.error(`[Messengers] Failed to refresh ${conversation.id}:`, error)
            })
        }
        // Chat view (`/chats/:id`) doesn't go through `listConversations`, so the
        // chat-list path's `maybeLazyRefreshAvatars` never fires when the user
        // opens a single conversation. Mirror the same trigger off the messages
        // endpoint: if the Yandex avatar is missing, kick a throttled
        // `refreshCandidates` so `backfillAvatarOnChatList` re-derives it.
        if (conversation.provider === 'yandex' && !conversation.avatarDataUrl) {
            const key = this.key(namespace, 'yandex')
            const last = this.avatarLazyRefreshAt.get(key) ?? 0
            if (Date.now() - last >= AVATAR_LAZY_REFRESH_INTERVAL_MS) {
                this.avatarLazyRefreshAt.set(key, Date.now())
                void this.refreshCandidates(namespace, 'yandex').catch((error) => {
                    console.error('[Messengers] Failed to lazy-refresh Yandex avatars:', error)
                })
            }
        }
        return cached
    }

    async sendText(
        namespace: string,
        conversationId: string,
        text: string,
        clientId?: string,
        replyToProviderMessageId?: string
    ): Promise<void> {
        const conversation = this.options.store.messengers.getConversation(namespace, conversationId)
        if (!conversation?.selected) throw new Error('Conversation not found')
        if (replyToProviderMessageId && !this.options.store.messengers.hasMessage(namespace, conversationId, replyToProviderMessageId)) {
            throw new Error('Message not found')
        }
        const connector = await this.requireConnector(namespace, conversation.provider)
        await this.waitForMediaPrefetchBackoff(namespace, conversation.provider)
        await connector.sendText(conversation.remoteId, text, clientId, replyToProviderMessageId)
        await this.refreshMessages(namespace, conversation, 100, true)
    }

    async setReactions(
        namespace: string,
        conversationId: string,
        providerMessageId: string,
        reactions: string[]
    ): Promise<void> {
        const conversation = this.options.store.messengers.getConversation(namespace, conversationId)
        if (!conversation?.selected) throw new Error('Conversation not found')
        if (!this.options.store.messengers.hasMessage(namespace, conversationId, providerMessageId)) {
            throw new Error('Message not found')
        }
        const connector = await this.requireConnector(namespace, conversation.provider)
        await connector.setReactions(conversation.remoteId, providerMessageId, reactions)
        await this.refreshMessages(namespace, conversation, 100, true)
    }

    async pressMessageButton(
        namespace: string,
        conversationId: string,
        providerMessageId: string,
        buttonId: string
    ): Promise<{ message: string | null }> {
        const conversation = this.options.store.messengers.getConversation(namespace, conversationId)
        if (!conversation?.selected) throw new Error('Conversation not found')
        const message = this.options.store.messengers.listMessages(namespace, conversationId, 200)
            .find((item) => item.providerMessageId === providerMessageId)
        if (!message) throw new Error('Message not found')
        if (!message.buttons?.some((row) => row.some((button) => button.id === buttonId && button.kind === 'callback'))) {
            throw new Error('Button not found')
        }
        const connector = await this.requireConnector(namespace, conversation.provider)
        if (!connector.pressButton) {
            throw new Error(`${conversation.provider} does not support pressing message buttons`)
        }
        const result = await connector.pressButton(conversation.remoteId, providerMessageId, buttonId)
        // Bots answer a press by editing their message (new text, new keyboard)
        // and/or sending follow-up messages; pull both in right away.
        await this.refreshMessages(namespace, conversation, 100, true)
        return result
    }

    async downloadMedia(
        namespace: string,
        conversationId: string,
        providerMessageId: string,
        mediaIndex: number
    ): Promise<DownloadedExternalMedia> {
        const conversation = this.options.store.messengers.getConversation(namespace, conversationId)
        if (!conversation?.selected) throw new Error('Conversation not found')
        const message = this.options.store.messengers.listMessages(namespace, conversationId, 200)
            .find((item) => item.providerMessageId === providerMessageId)
        if (!message?.media?.[mediaIndex]) throw new Error('Media attachment not found')
        const key = this.mediaKey(namespace, conversationId, providerMessageId, mediaIndex)
        this.mediaPrefetchQueued.delete(key)
        return await this.downloadMediaOnce(key, namespace, conversation, providerMessageId, mediaIndex)
    }

    async sendMedia(namespace: string, conversationId: string, input: {
        bytes: Uint8Array
        fileName: string
        mimeType: string
        caption: string
        clientId?: string
        replyToProviderMessageId?: string
    }): Promise<void> {
        const conversation = this.options.store.messengers.getConversation(namespace, conversationId)
        if (!conversation?.selected) throw new Error('Conversation not found')
        if (input.replyToProviderMessageId && !this.options.store.messengers.hasMessage(namespace, conversationId, input.replyToProviderMessageId)) {
            throw new Error('Message not found')
        }
        const connector = await this.requireConnector(namespace, conversation.provider)
        const uploadDir = join(this.namespaceDir(namespace, conversation.provider), 'uploads')
        await mkdir(uploadDir, { recursive: true, mode: 0o700 })
        const suffix = extname(input.fileName).slice(0, 12)
        const path = join(uploadDir, `${randomUUID()}${suffix}`)
        await writeFile(path, input.bytes, { mode: 0o600 })
        try {
            await this.waitForMediaPrefetchBackoff(namespace, conversation.provider)
            await connector.sendMedia(conversation.remoteId, {
                path,
                fileName: input.fileName,
                mimeType: input.mimeType,
                caption: input.caption,
                clientId: input.clientId,
                replyToProviderMessageId: input.replyToProviderMessageId
            })
        } finally {
            await unlink(path).catch(() => {})
        }
        await this.refreshMessages(namespace, conversation, 100, true)
    }

    async stop(): Promise<void> {
        this.stopped = true
        this.mediaPrefetchQueue.length = 0
        this.mediaPrefetchQueued.clear()
        this.mediaPrefetchPausedUntil.clear()
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
            this.options.store.messengers.reconcileMessageSnapshot(namespace, conversation.id, messages)
            for (const message of messages) this.enqueueMessageMedia(namespace, conversation, message, false)
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

    private async refreshSelectedConversationMetadata(namespace: string, provider: string): Promise<void> {
        const selectedIds = new Set(this.options.store.messengers.listConversations(namespace)
            .filter((conversation) => conversation.provider === provider)
            .map((conversation) => conversation.remoteId))
        if (selectedIds.size === 0) return
        await this.refreshCandidates(namespace, provider)
    }

    private async warmSelectedMessages(namespace: string, provider: string): Promise<void> {
        const conversations = this.options.store.messengers.listConversations(namespace)
            .filter((conversation) => conversation.provider === provider)
        for (const conversation of conversations) {
            if (this.stopped) return
            await this.refreshMessages(namespace, conversation, 100, true)
        }
    }

    private shouldPrefetchMedia(message: ExternalMessage, mediaIndex: number): boolean {
        const media = message.media?.[mediaIndex]
        if (!media || media.kind === 'file' || media.kind === 'location' || media.kind === 'contact' || media.kind === 'poll' || media.kind === 'other') {
            return false
        }
        if (media.size !== null && media.size > MAX_PREFETCH_MEDIA_BYTES) return false
        if (media.kind === 'video') return media.isRound === true || media.isAnimated === true || (media.size !== null && media.size <= MAX_PREFETCH_MEDIA_BYTES)
        return true
    }

    private mediaKey(namespace: string, conversationId: string, providerMessageId: string, mediaIndex: number): string {
        return `${namespace}\0${conversationId}\0${providerMessageId}\0${mediaIndex}`
    }

    private enqueueMessageMedia(
        namespace: string,
        conversation: ExternalConversation,
        message: ExternalMessage,
        highPriority: boolean
    ): void {
        for (let mediaIndex = 0; mediaIndex < (message.media?.length ?? 0); mediaIndex += 1) {
            if (!this.shouldPrefetchMedia(message, mediaIndex)) continue
            const key = this.mediaKey(namespace, conversation.id, message.providerMessageId, mediaIndex)
            if (this.mediaDownloads.has(key) || this.mediaPrefetchQueued.has(key)) continue
            const task = { key, namespace, conversation, providerMessageId: message.providerMessageId, mediaIndex }
            this.mediaPrefetchQueued.add(key)
            if (highPriority) this.mediaPrefetchQueue.unshift(task)
            else this.mediaPrefetchQueue.push(task)
        }
        void this.runMediaPrefetchQueue()
    }

    private async runMediaPrefetchQueue(): Promise<void> {
        if (this.mediaPrefetchRunning || this.stopped) return
        this.mediaPrefetchRunning = true
        try {
            while (!this.stopped) {
                const task = this.mediaPrefetchQueue.shift()
                if (!task) break
                if (!this.mediaPrefetchQueued.delete(task.key)) continue

                const connectorKey = this.key(task.namespace, task.conversation.provider)
                const pauseMs = (this.mediaPrefetchPausedUntil.get(connectorKey) ?? 0) - Date.now()
                if (pauseMs > 0) {
                    await new Promise((resolve) => setTimeout(resolve, pauseMs))
                    if (this.stopped) break
                }

                try {
                    await this.downloadMediaOnce(
                        task.key,
                        task.namespace,
                        task.conversation,
                        task.providerMessageId,
                        task.mediaIndex
                    )
                } catch (error) {
                    const floodWaitMs = getFloodWaitMs(error)
                    if (floodWaitMs !== null) {
                        this.mediaPrefetchPausedUntil.set(connectorKey, Date.now() + floodWaitMs)
                        this.mediaPrefetchQueued.add(task.key)
                        this.mediaPrefetchQueue.unshift(task)
                        console.warn(`[Messengers] Telegram requested media prefetch backoff for ${floodWaitMs}ms`)
                        continue
                    }
                    console.error('[Messengers] Failed to prefetch media:', error)
                }
                await new Promise((resolve) => setTimeout(resolve, MEDIA_PREFETCH_INTERVAL_MS))
            }
        } finally {
            this.mediaPrefetchRunning = false
            if (!this.stopped && this.mediaPrefetchQueue.length > 0) void this.runMediaPrefetchQueue()
        }
    }

    private async waitForMediaPrefetchBackoff(namespace: string, provider: string): Promise<void> {
        const connectorKey = this.key(namespace, provider)
        const pauseMs = (this.mediaPrefetchPausedUntil.get(connectorKey) ?? 0) - Date.now()
        if (pauseMs <= 0) return
        await new Promise((resolve) => setTimeout(resolve, pauseMs))
    }

    private downloadMediaOnce(
        key: string,
        namespace: string,
        conversation: ExternalConversation,
        providerMessageId: string,
        mediaIndex: number
    ): Promise<DownloadedExternalMedia> {
        const existing = this.mediaDownloads.get(key)
        if (existing) return existing
        const download = (async () => {
            const connector = await this.requireConnector(namespace, conversation.provider)
            return await connector.downloadMedia(conversation.remoteId, providerMessageId, mediaIndex)
        })().finally(() => {
            this.mediaDownloads.delete(key)
        })
        this.mediaDownloads.set(key, download)
        return download
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
            onEvent: (event) => this.handleEvent(namespace, event),
            backfillConversationAvatar: (remoteId, avatarDataUrl) => {
                // Connectors surface avatars that the chat-list payload did not
                // carry (typical for direct chats where `PartnerInfo.AvatarId`
                // is missing). Persist and broadcast so the chat list updates
                // without forcing a full refresh.
                const existing = this.options.store.messengers.getConversation(namespace, `yandex:${remoteId}`)
                if (!existing || existing.avatarDataUrl) return
                this.options.store.messengers.upsertConversation(namespace, {
                    ...existing,
                    avatarDataUrl
                })
                this.options.sseManager.broadcast({
                    type: 'external-conversation-updated',
                    namespace,
                    conversationId: existing.id
                })
            }
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
        if (connector.provider !== 'telegram' && connector.provider !== 'yandex') return
        const config = await this.readProviderConfig(namespace, connector.provider)
        if (!config) return
        try {
            await connector.configure(config)
        } catch (error) {
            console.error(`[Messengers] Failed to start ${connector.provider} connector:`, error)
        }
    }

    private async saveProviderConfig(namespace: string, provider: string, config: object): Promise<void> {
        const dir = this.namespaceDir(namespace, provider)
        await mkdir(dir, { recursive: true, mode: 0o700 })
        const path = join(dir, 'config.json')
        await writeFile(path, `${JSON.stringify(config)}\n`, { mode: 0o600 })
        await chmod(path, 0o600).catch(() => {})
    }

    /** Re-reads and re-validates a saved provider config after a hub restart. */
    private async readProviderConfig(namespace: string, provider: string): Promise<object | null> {
        try {
            const raw = await readFile(join(this.namespaceDir(namespace, provider), 'config.json'), 'utf8')
            const value = JSON.parse(raw) as Record<string, unknown>
            if (!value || typeof value !== 'object') return null
            if (provider === 'telegram') {
                if (!Number.isInteger(value.apiId) || typeof value.apiHash !== 'string') return null
                return { apiId: value.apiId as number, apiHash: value.apiHash }
            }
            if (provider === 'yandex') {
                if (typeof value.cookies !== 'string' || value.cookies.trim().length === 0) return null
                return { cookies: value.cookies }
            }
            return null
        } catch {
            return null
        }
    }

    private openConversationKey(namespace: string, conversationId: string): string {
 return `${ namespace }::${ conversationId }`
 }

 /**
 * Mark a conversation as currently open in the operator's web UI, or closed.
 * When transitioning to open we immediately fire `markReadForConversation` so
 * any unread backlog is durably marked as read on the provider (catches the
 * case where the user opens a chat whose `unreadCount` is stale).
 */
 async setConversationOpen(namespace: string, conversationId: string, isOpen: boolean): Promise<void> {
 const key = this.openConversationKey(namespace, conversationId)
 if (isOpen) {
 if (this.openConversations.has(key)) return
 this.openConversations.add(key)
 const conversation = this.options.store.messengers.getConversation(namespace, conversationId)
 if (conversation) await this.markReadForConversation(namespace, conversation)
 return
 }
 this.openConversations.delete(key)
 }

 private isConversationOpen(namespace: string, conversationId: string): boolean {
 return this.openConversations.has(this.openConversationKey(namespace, conversationId))
 }

 /**
 * Push a `SeenMarker` (or provider equivalent) using the highest cursor known
 * to the local store. No-op when the chat has no messages yet or when the
 * provider does not implement `markRead`.
 */
 private async markReadForConversation(namespace: string, conversation: ExternalConversation): Promise<void> {
 const cached = this.options.store.messengers.listMessages(namespace, conversation.id)
 if (cached.length === 0) return
 let maxProviderMessageId = 0
 let maxSeqNo: number | undefined
 let maxVersion: number | undefined
 for (const message of cached) {
 const id = Number(message.providerMessageId)
 if (Number.isSafeInteger(id) && id > maxProviderMessageId) {
 maxProviderMessageId = id
 }
 if (message.seqNo !== undefined) {
 if (maxSeqNo === undefined || message.seqNo > maxSeqNo) {
 maxSeqNo = message.seqNo
 maxVersion = message.version ?? 1
 }
 }
 }
 if (maxProviderMessageId <= 0) return
 const connector = await this.requireConnector(namespace, conversation.provider)
 const cursor = maxSeqNo !== undefined && maxVersion !== undefined
 ? { seqNo: maxSeqNo, version: maxVersion }
 : undefined
 try {
 await connector.markRead?.(conversation.remoteId, maxProviderMessageId, cursor)
 } catch (error) {
 console.error(`[Messengers] Failed to mark ${conversation.id} read (real-time):`, error)
 }
 }

 /**
 * Re-derive `deliveryStatus = 'read'` for outgoing messages in the open chat
 * whenever the connector signals that the latest outgoing message flipped to
 * `read`. Because `LastSeenSeqNo` is monotonic, "last message read" implies
 * "every prior outgoing message read" — so we walk every outgoing row and
 * mark it through the store's existing read-sweep path. Broadcasts the
 * per-message update event so the open chat's ✓✓ flips without waiting for
 * a UI refetch.
 */
 private applyPeerReadForConversation(namespace: string, conversation: ExternalConversation): void {
 if (conversation.lastMessageDeliveryStatus !== 'read') return
 const cached = this.options.store.messengers.listMessages(namespace, conversation.id)
 let maxTimestamp: number | null = null
 for (const message of cached) {
 if (message.direction !== 'outgoing') continue
 const id = Number(message.providerMessageId)
 if (Number.isSafeInteger(id)) {
 if (maxTimestamp === null || id > maxTimestamp) maxTimestamp = id
 }
 }
 if (maxTimestamp === null) return
 this.options.store.messengers.markOutgoingMessagesRead(namespace, conversation.id, maxTimestamp)
 this.options.sseManager.broadcast({
 type: 'external-message-updated',
 namespace,
 conversationId: conversation.id
 })
 }

 private handleEvent(namespace: string, event: MessengerConnectorEvent): void {
        if (event.type === 'connection') {
            this.options.sseManager.broadcast({
                type: 'messenger-connection-updated',
                namespace,
                provider: event.connection.provider
            })
            if (event.connection.state === 'ready') {
                void (async () => {
                    await this.refreshSelectedConversationMetadata(namespace, event.connection.provider)
                    await this.warmSelectedMessages(namespace, event.connection.provider)
                })().catch((error) => {
                    console.error('[Messengers] Failed to warm selected conversations:', error)
                })
            }
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
            // Real-time peer read receipts: while the chat is open, every
            // `conversation` event from the connector is an opportunity to flip
            // outgoing messages to `read` against the latest peer cursor.
            if (this.isConversationOpen(namespace, event.conversation.id)) {
                this.applyPeerReadForConversation(namespace, event.conversation)
            }
            return
        }
        if (event.type === 'messages-deleted') {
            const conversations = this.options.store.messengers.listConversations(namespace)
                .filter((conversation) => conversation.provider === event.provider)
            const targets = event.remoteId
                ? conversations.filter((conversation) => conversation.remoteId === event.remoteId)
                : conversations.filter((conversation) => !conversation.remoteId.startsWith('channel:'))
            const affected = targets.flatMap((conversation) => this.options.store.messengers.deleteMessages(
                namespace,
                event.provider,
                event.providerMessageIds,
                conversation.id
            ))
            for (const id of affected) {
                this.options.sseManager.broadcast({
                    type: 'external-message-received',
                    namespace,
                    conversationId: id
                })
            }
            return
        }
        if (event.type === 'messages-read') {
            const conversation = this.options.store.messengers.listConversations(namespace)
                .find((item) => item.provider === event.provider && item.remoteId === event.remoteId)
            if (!conversation) return
            this.options.store.messengers.markOutgoingMessagesRead(
                namespace,
                conversation.id,
                event.maxProviderMessageId
            )
            this.options.sseManager.broadcast({
                type: 'external-message-updated',
                namespace,
                conversationId: conversation.id
            })
            return
        }
        if (event.type === 'inbox-read') {
            const conversation = this.options.store.messengers.listConversations(namespace)
                .find((item) => item.provider === event.provider && item.remoteId === event.remoteId)
            if (!conversation) return
            this.options.store.messengers.setUnreadCount(namespace, conversation.id, event.unreadCount)
            this.options.sseManager.broadcast({
                type: 'external-conversation-updated',
                namespace,
                conversationId: conversation.id
            })
            return
        }
        if (event.type === 'message-reactions') {
            const conversation = this.options.store.messengers.listConversations(namespace)
                .find((item) => item.provider === event.provider && item.remoteId === event.remoteId)
            if (!conversation) return
            const updated = this.options.store.messengers.updateMessageReactions(
                namespace,
                conversation.id,
                event.providerMessageId,
                event.reactions
            )
            if (updated) {
                this.options.sseManager.broadcast({
                    type: 'external-message-updated',
                    namespace,
                    conversationId: conversation.id
                })
            }
            return
        }
        const conversation = this.options.store.messengers.getConversation(namespace, event.message.conversationId)
        if (!conversation?.selected) return
        const isNew = !this.options.store.messengers.hasMessage(
            namespace,
            event.message.conversationId,
            event.message.providerMessageId
        )
        this.options.store.messengers.upsertMessage(namespace, event.message)
        this.enqueueMessageMedia(namespace, conversation, event.message, true)
        if (isNew && event.message.direction === 'incoming') {
            this.options.store.messengers.incrementUnreadCount(namespace, event.message.conversationId)
        }
        this.options.sseManager.broadcast({
            type: 'external-message-received',
            namespace,
            conversationId: event.message.conversationId
        })
        // While the chat is open, emit a SeenMarker the instant a new message
        // arrives (incoming or echo of our own outgoing). The provider
        // collapses the push to a no-op when the cursor is already current.
        if (this.isConversationOpen(namespace, event.message.conversationId)) {
            void this.markReadForConversation(namespace, conversation)
        }
    }
}
