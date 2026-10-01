/**
 * Personal-account Yandex Messenger connector (the messenger that now lives in the
 * Telemost app under the Chats tab).
 *
 * There is no public API for the personal messenger: this connector speaks the
 * reverse-engineered chats-web protocol — registry HTTP for identity and files, and a
 * xiva WebSocket for `history` reads and `push` mutations. Auth is the session cookies
 * of an already logged-in browser profile, pasted by the user in settings.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type {
    ConfigureYandexRequest,
    ExternalConversation,
    ExternalMessage,
    MessengerConnection,
    SubmitMessengerAuthRequest
} from '@hapi/protocol'
import type { DownloadedExternalMedia, MessengerConnector, MessengerConnectorEvent, SendExternalMediaInput } from '../types'
import { createPayloadId, PUSH_METHOD, XivaClient } from './xivaClient'
import { CookieRejectedError, RegistryClient, toWireTimestamp } from './registry'
import { reactionTypeForEmoji } from './reactionMap'
import { buildFileClientMessage, buildImageClientMessage } from './pushShape'
import {
    buildAvatarUrlFromId,
    buildHistoryParams,
    normalizeChatElement,
    normalizeMessageItem,
    sortMessagesAscending,
    type AttachmentRef,
    type YandexMessage
} from './shapes'

/** Push commit statuses meaning the mutation is durably accepted. */
const COMMITTED_PUSH_STATUSES = new Set([1, 8])
const PUSH_COMMIT_STATUS_NAMES: Record<number, string> = {
    0: 'UNCOMMITTED',
    1: 'FULLY_COMMITTED',
    2: 'UNIPROXY_COMMITTED',
    3: 'FAILED',
    4: 'NO_SUCH_CHAT',
    7: 'SENDER_NOT_IN_CHAT',
    8: 'DUPLICATE',
    18: 'THROTTLED',
    22: 'SPAM_DETECTED',
    23: 'RATE_LIMIT_EXCEEDED'
}

const USER_AGENT = 'chats-web/3.22.0'
const SERVICE_ID = 27
const FILE_PRIVATE_HOST = 'files.messenger.yandex.ru'
const CHAT_LIST_LIMIT = 50
const DEBOUNCE_MS = 800
const REACTION_ACTION_REMOVE = 1
/**
 * chats-web presence: send `Heartbeat: { Type: 2 }` (FOREGROUND) periodically
 * to keep this account flagged as online for the peer. The server derives
 * `onlineUntil = lastSeenMs + onlineDuration*1000`, so missing a beat drops us
 * back to "last seen recently". Interval tuned conservatively to avoid rate
 * limits; chats-web keeps the WebSocket alive through server-driven pings
 * regardless.
 */
const HEARTBEAT_INTERVAL_MS = 60_000
/** `HeartbeatType.FOREGROUND=2` in §9.3 — explicitly online. */
const HEARTBEAT_TYPE_FOREGROUND = 2

/** `Meta.LogData.YandexUid` comes from the `yandexuid` cookie, not from request_user. */
function yandexUidFromCookies(cookieHeader: string): string | undefined {
    const match = cookieHeader.match(/(?:^|;\s*)yandexuid=(\d+)/)
    return match?.[1]
}

/**
 * Splits a Yandex chat id `<a>_<b>` and returns the side that is not `myGuid`,
 * or `null` for saved-messages / malformed ids. Direct chats follow this gate
 * format on the wire; group chats use `0/0/<id>` and won't match.
 */
function partnerGuidFromChatId(remoteId: string, myGuid: string): string | null {
    const parts = remoteId.split('_', 2)
    if (parts.length !== 2) return null
    const [a, b] = parts
    if (!a || !b) return null
    if (a === myGuid && b === myGuid) return null
    if (a === myGuid) return b
    if (b === myGuid) return a
    return b
}

/** Download URLs are client-built from `FileInfo.Id2`; validate the `<bucket>/<uuid>` shape. */
function assertSafeFileId(fileId: string): void {
    const segments = fileId.split('/')
    for (const segment of segments) {
        if (!/^[A-Za-z0-9._-]+$/.test(segment) || segment === '.' || segment === '..') {
            throw new Error('attachment id has an unexpected shape')
        }
    }
}

/**
 * Build the download URL for one attachment.
 *
 * Regular attachments (Image / MiscFile / Voice / Gallery) carry a `FileInfo.Id2`
 * of the form `<bucket>/<uuid>` and live under `/file_shortterm/<id>` on the
 * messenger private host. The `?attach=true` flag is what the Yandex CDN uses
 * to set the right Content-Disposition for inline preview.
 *
 * Stickers observed live on 2026-09-29 use a different namespace: the wire
 * `Plain.Sticker.Id` is already a relative path on the same host (e.g.
 * `stickers/images/2509/28331.png`), and the messenger CDN returns a 301 to
 * the public `avatars.mds.yandex.net` URL for that same image. The path is
 * ASCII-safe and passes `assertSafeFileId`, so we can reuse the same segment
 * validation before hitting the network.
 */
export function buildMediaUrl(ref: AttachmentRef): string {
    if (ref.kind === 'sticker') {
        return `https://${FILE_PRIVATE_HOST}/${ref.fileId}`
    }
    return `https://${FILE_PRIVATE_HOST}/file_shortterm/${ref.fileId}?attach=true`
}

interface ChatSnapshot {
    lastMessageMicros?: bigint
    lastMessage?: YandexMessage
    unread: number
    peerLastSeenSeqNo?: number
}

export class YandexConnector implements MessengerConnector {
    readonly provider = 'yandex'
    private connection: MessengerConnection = {
        provider: 'yandex',
        state: 'unconfigured',
        accountLabel: null,
        detail: null,
        accountAvatarUrl: null
    }

    private cookies: string | null = null
    private registry: RegistryClient | null = null
    private xiva: XivaClient | null = null
    private myGuid: string | null = null
    private myUid: string | null = null
    private readonly chatSnapshots = new Map<string, ChatSnapshot>()
    private readonly messageSnapshots = new Map<string, Map<string, { attachments: AttachmentRef[]; chosen: Set<number> }>>()
    private refreshTimer: ReturnType<typeof setTimeout> | null = null
    private heartbeatTimer: ReturnType<typeof setTimeout> | null = null

    constructor(private readonly options: {
        namespace: string
        dataDir: string
        onEvent: (event: MessengerConnectorEvent) => void
        backfillConversationAvatar?: (remoteId: string, avatarDataUrl: string) => void
    }) {}

    getConnection(): MessengerConnection {
        return this.connection
    }

    async configure(config: unknown): Promise<void> {
        const typed = config as ConfigureYandexRequest
        const cookies = typed?.cookies?.trim()
        if (!cookies) throw new Error('Yandex Messenger requires session cookies')
        this.setConnection({ state: 'starting', detail: null })
        const registry = new RegistryClient(cookies)
        let identity
        try {
            identity = await registry.requestUser()
        } catch (error) {
            const detail = error instanceof CookieRejectedError
                ? 'Session cookies were rejected. Copy a fresh Cookie header from a logged-in yandex.ru tab.'
                : error instanceof Error ? error.message : 'Yandex Messenger authentication failed'
            this.setConnection({ state: 'error', detail })
            throw error
        }
        this.cookies = cookies
        this.registry = registry
        this.myGuid = identity.guid
        this.myUid = identity.uid ?? null
        const accountAvatarUrl = identity.avatarId && identity.avatarId.length > 0
            ? buildAvatarUrlFromId(identity.avatarId)
            : null
        this.setConnection({
            state: 'ready',
            accountLabel: identity.displayName ?? identity.uid ?? identity.guid,
            detail: null,
            accountAvatarUrl
        })
        // A re-configure must drop the socket opened with the previous cookies.
        this.xiva?.close()
        this.xiva = null
        await this.ensureXiva()
    }

    async submitAuth(_input: SubmitMessengerAuthRequest): Promise<void> {
        throw new Error('Yandex Messenger does not use interactive auth; update session cookies instead')
    }

    async listConversations(): Promise<ExternalConversation[]> {
        const data = await this.requestHistory(buildHistoryParams({ limit: CHAT_LIST_LIMIT }))
        const elements = Array.isArray(data['Chats']) ? data['Chats'] as unknown[] : []
        const conversations: ExternalConversation[] = []
        for (const element of elements) {
            const shape = normalizeChatElement(element, this.requireGuid())
            if (!shape) continue
            this.rememberChat(shape.conversation.remoteId, {
                lastMessageMicros: shape.lastMessage?.micros,
                lastMessage: shape.lastMessage,
                unread: shape.conversation.unreadCount,
                peerLastSeenSeqNo: shape.peerLastSeenSeqNo
            })
            if (shape.lastMessage) this.rememberMessage(shape.conversation.remoteId, shape.lastMessage)
            conversations.push(shape.conversation)
        }
        await this.enrichMissingAvatars(conversations)
        return conversations
    }

    /**
     * Batch-fallback avatar enrichment for direct chats whose `PartnerInfo.AvatarId`
     * was missing from the binary `history` payload. We collect the partner guid
     * out of the chat id (`<a>_<b>`), ask registry `get_users_data` for the whole
     * batch, and patch the `avatarDataUrl` on each conversation before it lands in
     * the store. Registry errors are soft — the chat list keeps rendering with the
     * initials fallback when avatars can't be enriched.
     */
    private async enrichMissingAvatars(conversations: ExternalConversation[]): Promise<void> {
        const registry = this.registry
        if (!registry) return
        const myGuid = this.myGuid
        if (!myGuid) return
        const partnerGuids = new Set<string>()
        for (const conversation of conversations) {
            if (conversation.avatarDataUrl) continue
            // `kind` may be stale in the DB (the binary WS payload no longer
            // exposes `PrivateChatInfo`), so we infer "this chat has a partner
            // we can look up" from the chat id shape rather than from `kind`.
            const partner = partnerGuidFromChatId(conversation.remoteId, myGuid)
            if (partner) partnerGuids.add(partner)
        }
        if (partnerGuids.size === 0) return
        try {
            const users = await registry.requestUsers([...partnerGuids])
            const urlByGuid = new Map<string, string>()
            for (const user of users) {
                if (!user.avatarId) continue
                try {
                    urlByGuid.set(user.guid, buildAvatarUrlFromId(user.avatarId))
                } catch (error) {
                    console.error('[Yandex] Failed to build avatar URL for guid', user.guid, error)
                }
            }
            if (urlByGuid.size === 0) return
            for (const conversation of conversations) {
                if (conversation.avatarDataUrl) continue
                const partner = partnerGuidFromChatId(conversation.remoteId, myGuid)
                if (!partner) continue
                const url = urlByGuid.get(partner)
                if (url) conversation.avatarDataUrl = url
            }
        } catch (error) {
            console.error('[Yandex] Avatar enrichment via registry failed:', error)
        }
    }

    async loadMessages(remoteId: string, limit = 100): Promise<ExternalMessage[]> {
        const safeLimit = Math.min(200, Math.max(1, limit))
        const data = await this.requestHistory(buildHistoryParams({ chatId: remoteId, limit: safeLimit }))
        const elements = Array.isArray(data['Chats']) ? data['Chats'] as unknown[] : []
        const chatElement = elements.find((entry) =>
            (entry as { ChatId?: unknown } | null)?.ChatId === remoteId)
        const peerLastSeenSeqNo = (chatElement as { LastSeenSeqNo?: unknown } | null)?.LastSeenSeqNo
        const rawMessages = Array.isArray((chatElement as { Messages?: unknown } | null)?.Messages)
            ? (chatElement as { Messages: unknown[] }).Messages
            : []
        const messages: YandexMessage[] = []
        for (const raw of rawMessages) {
            const normalized = normalizeMessageItem(raw, this.requireGuid(), remoteId,
                typeof peerLastSeenSeqNo === 'number' ? peerLastSeenSeqNo : undefined)
            if (normalized) messages.push(normalized)
        }
        const ordered = sortMessagesAscending(messages)
        let maxMicros = 0n
        for (const message of ordered) {
            this.rememberMessage(remoteId, message)
            if (message.micros > maxMicros) maxMicros = message.micros
        }
        this.rememberChat(remoteId, {
            lastMessageMicros: maxMicros > 0n ? maxMicros : undefined,
            lastMessage: ordered[ordered.length - 1],
            unread: this.chatSnapshots.get(remoteId)?.unread ?? 0,
            peerLastSeenSeqNo: typeof peerLastSeenSeqNo === 'number' ? peerLastSeenSeqNo : undefined
        })
        this.maybeBackfillPartnerAvatar(remoteId, ordered)
        return ordered.map((message) => message.message)
    }

    /**
     * Backfill `conversation.avatarDataUrl` for direct chats whose
     * `PartnerInfo.AvatarId` was missing from the chat-list payload. The avatar
     * rides on each message's `From.UserInfo.AvatarId` instead, so any message
     * from the partner is a valid source. We pick the earliest message with a
     * usable `senderAvatarUrl` so subsequent loads (which only fetch recent
     * messages) keep the avatar stable. The manager owns the actual store
     * update and SSE broadcast; this method only signals intent.
     */
    private maybeBackfillPartnerAvatar(remoteId: string, ordered: YandexMessage[]): void {
        const callback = this.options.backfillConversationAvatar
        if (!callback) return
        const partnerGuid = partnerGuidFromChatId(remoteId, this.requireGuid())
        if (!partnerGuid) return
        // Use the earliest message that carries a usable sender avatar so
        // subsequent loads (which only fetch recent messages) keep the avatar
        // stable.
        for (const message of ordered) {
            const avatarUrl = message.senderAvatarUrl
            if (!avatarUrl) continue
            if (message.message.senderId !== partnerGuid) continue
            callback(remoteId, avatarUrl)
            return
        }
    }

    async markRead(
        remoteId: string,
        maxProviderMessageId: number,
        cursor?: { seqNo: number; version: number }
    ): Promise<void> {
        // chats-web `SeenMarker` requires `{ChatId, Timestamp, SeqNo, Version}` per
        // §9.3 of the protocol research; without `SeqNo`/`Version` the mutation
        // is silently dropped by the server, so a "seen" never reaches the peer.
        // When the manager did not yet observe a seqNo (older cache), we keep the
        // legacy `{ChatId, Timestamp}` envelope so we don't regress pre-fix chats.
        const timestamp = toWireTimestamp(BigInt(maxProviderMessageId))
        const seenMarker: Record<string, unknown> = cursor
            ? { ChatId: remoteId, Timestamp: timestamp, SeqNo: cursor.seqNo, Version: cursor.version }
            : { ChatId: remoteId, Timestamp: timestamp }
        // Diagnostic: log the exact SeenMarker envelope we are about to send. Helps
        // verify on a deployed hub that `SeqNo`/`Version` are populated, since the
        // server silently drops SeenMarker without them and the peer never sees the
        // read receipt. Always on — the chatter is bounded by user-initiated chat
        // opens, so prod noise stays minimal while we still have live unknowns.
        console.log('[Yandex connector] markRead', {
            remoteId,
            maxProviderMessageId,
            seenMarker
        })
        await this.pushMutation({ SeenMarker: seenMarker })
        const snapshot = this.chatSnapshots.get(remoteId)
        if (snapshot) snapshot.unread = 0
    }

    async sendText(remoteId: string, text: string, clientId?: string): Promise<void> {
        void clientId
        await this.pushMutation({
            Plain: {
                ChatId: remoteId,
                PayloadId: createPayloadId(),
                Text: { MessageText: text }
            }
        })
    }

    async setReactions(remoteId: string, providerMessageId: string, reactions: string[]): Promise<void> {
        // Resolve desired types first so an unknown emoji fails before any irreversible push.
        const desired = new Set<number>()
        for (const emoji of reactions) {
            const type = reactionTypeForEmoji(emoji)
            if (type === null) throw new Error(`Reaction is not supported by Yandex Messenger: ${emoji}`)
            desired.add(type)
        }
        const chosen = this.messageSnapshots.get(remoteId)?.get(providerMessageId)?.chosen
        const current = chosen ?? new Set<number>()
        for (const type of current) {
            if (!desired.has(type)) {
                await this.pushMutation({
                    Reaction: {
                        ChatId: remoteId,
                        Timestamp: toWireTimestamp(BigInt(providerMessageId)),
                        Type: type,
                        Action: REACTION_ACTION_REMOVE
                    }
                })
            }
        }
        for (const type of desired) {
            if (!current.has(type)) {
                await this.pushMutation({
                    Reaction: {
                        ChatId: remoteId,
                        Timestamp: toWireTimestamp(BigInt(providerMessageId)),
                        Type: type
                    }
                })
            }
        }
        if (chosen) {
            chosen.clear()
            for (const type of desired) chosen.add(type)
        }
    }

    async downloadMedia(remoteId: string, providerMessageId: string, mediaIndex: number): Promise<DownloadedExternalMedia> {
        const entry = this.messageSnapshots.get(remoteId)?.get(providerMessageId)
        const ref = entry?.attachments[mediaIndex]
        if (!ref) throw new Error('Media attachment not found')
        assertSafeFileId(ref.fileId)
        const url = buildMediaUrl(ref)
        const response = await fetch(url, {
            headers: {
                Cookie: this.requireCookies(),
                Referer: 'https://yandex.ru/chat'
            }
        })
        if (!response.ok) throw new Error(`Attachment download failed with HTTP ${response.status}`)
        const bytes = new Uint8Array(await response.arrayBuffer())
        const mediaRoot = join(this.options.dataDir, 'media-cache')
        await mkdir(mediaRoot, { recursive: true, mode: 0o700 })
        const fileName = ref.name ?? `attachment-${providerMessageId}-${mediaIndex}`
        const path = join(mediaRoot, `${providerMessageId}-${mediaIndex}-${fileName.replace(/[^\w.-]+/g, '_')}`)
        await writeFile(path, bytes, { mode: 0o600 })
        return {
            path,
            mimeType: response.headers.get('content-type') ?? 'application/octet-stream',
            fileName,
            size: bytes.byteLength
        }
    }

    async sendMedia(remoteId: string, input: SendExternalMediaInput): Promise<void> {
        const bytes = new Uint8Array(await readFile(input.path))
        const uploadId = createPayloadId()
        const upload = await this.requireRegistry().call<{ files?: Array<{ upload_url?: unknown }> }>(
            'upload_to_disk',
            { files: [{ name: input.fileName, upload_id: uploadId, size: bytes.byteLength, chat_id: remoteId }] },
            { csrf: true }
        )
        const uploadUrl = typeof upload.files?.[0]?.upload_url === 'string' ? upload.files?.[0]?.upload_url : undefined
        if (!uploadUrl) throw new Error('upload_to_disk did not return an upload_url')
        const putResponse = await fetch(uploadUrl, {
            method: 'PUT',
            body: bytes,
            headers: {
                'Content-Type': input.mimeType || 'application/octet-stream',
                Cookie: this.requireCookies(),
                Referer: 'https://yandex.ru/chat'
            }
        })
        if (!putResponse.ok) throw new Error(`Attachment upload failed with HTTP ${putResponse.status}`)
        const location = putResponse.headers.get('location')
        if (!location) throw new Error('Attachment upload did not return a Location')
        const registered = await this.requireRegistry().call<{ files?: Array<{ id?: unknown }> }>(
            'add_files',
            { chat_id: remoteId, files: [{ location }] },
            { csrf: true }
        )
        const fileId = typeof registered.files?.[0]?.id === 'string' ? registered.files?.[0]?.id : undefined
        if (!fileId) throw new Error('add_files did not return a file id')

        const payloadId = input.clientId ?? createPayloadId()
        if (input.mimeType.startsWith('image/')) {
            /* Telemost fullscreen renders the image at the declared size; without Width/Height
             * it falls back to a black placeholder, even though the file itself is reachable
             * (miniatures still work because the server sizes them from the original bytes).
             * GIFs hit the same path - animation has no separate wire flag. */
            await this.pushMutation(buildImageClientMessage({
                chatId: remoteId,
                payloadId,
                fileId,
                fileName: input.fileName,
                size: bytes.byteLength,
                bytes,
                mimeType: input.mimeType
            }))
        } else {
            await this.pushMutation(buildFileClientMessage({
                chatId: remoteId,
                payloadId,
                fileId,
                fileName: input.fileName,
                size: bytes.byteLength
            }))
        }
        // A caption rides as its own text message: the outgoing image+caption wire form
        // (Gallery) has never been observed live, and a wrong shape would silently drop text.
        if (input.caption.trim().length > 0) {
            await this.sendText(remoteId, input.caption)
        }
    }

    async stop(): Promise<void> {
        if (this.refreshTimer !== null) clearTimeout(this.refreshTimer)
        this.refreshTimer = null
        this.stopHeartbeat()
        this.xiva?.close()
        this.xiva = null
    }

    /* ---------- internals ---------- */

    private setConnection(patch: Partial<MessengerConnection>): void {
        this.connection = { ...this.connection, ...patch }
        this.options.onEvent({ type: 'connection', connection: this.connection })
    }

    private requireGuid(): string {
        if (!this.myGuid) throw new Error('Yandex Messenger is not configured')
        return this.myGuid
    }

    private requireCookies(): string {
        if (!this.cookies) throw new Error('Yandex Messenger is not configured')
        return this.cookies
    }

    private requireRegistry(): RegistryClient {
        if (!this.registry) throw new Error('Yandex Messenger is not configured')
        return this.registry
    }

    private async ensureXiva(): Promise<void> {
        if (this.xiva) return
        const client = new XivaClient({
            user: this.myUid ?? this.requireGuid(),
            cookieHeader: this.requireCookies(),
            onPush: () => this.scheduleDiffRefresh(),
            onAuthFailure: (detail) => {
                this.setConnection({
                    state: 'error',
                    detail: `Session expired: ${detail}. Update cookies in settings.`
                })
            },
            onConnected: () => {
                if (this.connection.state !== 'ready') {
                    this.setConnection({ state: 'ready', detail: null })
                }
                void this.refreshChats().catch((error) => {
                    console.error('[Yandex connector] initial chat refresh failed:', error)
                })
                // Declare ourselves online once the live channel is up; the
                // timer keeps re-asserting presence at HEARTBEAT_INTERVAL_MS.
                this.startHeartbeat()
            }
        })
        this.xiva = client
        try {
            await client.connect()
        } catch (error) {
            const detail = error instanceof Error ? error.message : 'xiva connection failed'
            this.setConnection({ state: 'error', detail: `Live connection failed: ${detail}` })
            throw error
        }
    }

    /** Single read method of the protocol: WS `history`. */
    private async requestHistory(params: Record<string, unknown>): Promise<Record<string, unknown>> {
        await this.ensureXiva()
        const response = await this.xiva!.request('history', params) as Record<string, unknown> | undefined
        if (!response || typeof response !== 'object') throw new Error('history returned no payload')
        return response
    }

    /** The only mutation channel: WS `push` with the full client envelope. */
    private async pushMutation(clientMessage: Record<string, unknown>): Promise<void> {
        await this.ensureXiva()
        const subscriptionId = await this.xiva!.waitForSubscriptionId()
        const yandexUid = yandexUidFromCookies(this.requireCookies()) ?? this.myUid ?? this.requireGuid()
        const params = {
            ClientTransportId: { XivaSubscriptionId: subscriptionId },
            UserAgent: USER_AGENT,
            ClientMessage: { ...clientMessage, LogData: { YandexUid: yandexUid } },
            Meta: { Origin: SERVICE_ID },
            ClientSupportedFeatures: 0
        }
        const response = await this.xiva!.request(PUSH_METHOD, params) as { Status?: unknown } | undefined
        const status = typeof response?.Status === 'number' ? response.Status : undefined
        if (status === undefined || !COMMITTED_PUSH_STATUSES.has(status)) {
            const name = status !== undefined ? (PUSH_COMMIT_STATUS_NAMES[status] ?? `STATUS_${status}`) : 'NO_CONFIRMATION'
            throw new Error(`Yandex Messenger did not accept the message (${name})`)
        }
    }

    private rememberChat(remoteId: string, patch: ChatSnapshot): void {
        const existing = this.chatSnapshots.get(remoteId)
        this.chatSnapshots.set(remoteId, { ...existing, ...patch })
    }

    /**
     * Schedules the periodic `Heartbeat` push that keeps this account flagged as
     * "online" to the chats-web server. Idempotent: re-calling resets the
     * schedule (used by `onConnected` after every xiva reconnect). Errors from a
     * single heartbeat are logged but never propagate, so a misbehaving backend
     * can't tear down the connector.
     */
    private startHeartbeat(): void {
        this.stopHeartbeat()
        const scheduleNext = (): void => {
            if (this.connection.state !== 'ready') return
            this.heartbeatTimer = setTimeout(() => {
                this.heartbeatTimer = null
                this.startHeartbeat()
            }, HEARTBEAT_INTERVAL_MS)
        }
        // Fire the first beat immediately so the peer flips to "online" as
        // soon as the live channel is up; subsequent beats fall on the timer.
        void this.sendHeartbeat().catch((error) => {
            console.error('[Yandex connector] heartbeat push failed:',
                error instanceof Error ? error.message : error)
        }).finally(scheduleNext)
    }

    private stopHeartbeat(): void {
        if (this.heartbeatTimer !== null) {
            clearTimeout(this.heartbeatTimer)
            this.heartbeatTimer = null
        }
    }

    private async sendHeartbeat(): Promise<void> {
        // FOREGROUND signals an active user-facing session. `pushMutation`
        // throws on a non-committed push status; the caller swallows.
        await this.pushMutation({ Heartbeat: { Type: HEARTBEAT_TYPE_FOREGROUND } })
    }

    private rememberMessage(remoteId: string, message: YandexMessage): void {
        let bucket = this.messageSnapshots.get(remoteId)
        if (!bucket) {
            bucket = new Map()
            this.messageSnapshots.set(remoteId, bucket)
        }
        bucket.set(message.message.providerMessageId, {
            attachments: message.attachments,
            chosen: new Set(message.chosenReactionTypes)
        })
        // The snapshot only backs downloads and reaction diffs; keep it bounded.
        if (bucket.size > 400) {
            const excess = bucket.size - 400
            let dropped = 0
            for (const key of bucket.keys()) {
                bucket.delete(key)
                dropped += 1
                if (dropped >= excess) break
            }
        }
    }

    /**
     * Server push frames do not carry parsed payloads here; instead any activity
     * triggers a debounced chat-list refresh whose diff produces the same events the
     * manager already consumes (new messages, unread counters, previews).
     */
    private scheduleDiffRefresh(): void {
        if (this.refreshTimer !== null) return
        this.refreshTimer = setTimeout(() => {
            this.refreshTimer = null
            void this.refreshChats().catch((error) => {
                console.error('[Yandex connector] chat refresh failed:', error)
            })
        }, DEBOUNCE_MS)
    }

    private async refreshChats(): Promise<void> {
        if (this.connection.state !== 'ready') return
        // Snapshot before reading: listConversations overwrites the cache in place.
        const before = new Map(this.chatSnapshots)
        const conversations = await this.listConversations()
        for (const conversation of conversations) {
            const prior = before.get(conversation.remoteId)
            const current = this.chatSnapshots.get(conversation.remoteId)
            // Only an advance over a previously seen mark is a live message; the very
            // first sync replays nothing (the manager warms the selected chat itself).
            if (prior?.lastMessageMicros !== undefined && current?.lastMessage
                && current.lastMessage.micros > prior.lastMessageMicros) {
                this.options.onEvent({ type: 'message', message: current.lastMessage.message })
            }
            if (!prior || prior.unread !== conversation.unreadCount) {
                this.options.onEvent({
                    type: 'inbox-read',
                    provider: this.provider,
                    remoteId: conversation.remoteId,
                    unreadCount: conversation.unreadCount
                })
            }
            this.options.onEvent({ type: 'conversation', conversation })
        }
    }
}
