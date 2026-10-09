/**
 * Normalization of history-response shapes into HAPI's external messenger types.
 *
 * Wire facts are reverse-engineered from the chats-web client (see the reference
 * project conarti/yandex-messenger-mcp): a chat element carries
 * `ChatId, ChatInfo?, PartnerInfo?, PrivateChatInfo?, LastSeqNo, LastTsMcs,
 * LastSeenByMeSeqNo, ...`, and each message element carries
 * `{ServerMessage: {ClientMessage, ServerMessageInfo, Reactions?, RecentUserReactions?}}`.
 * The unseen sequence gap includes outgoing messages; exclude known self sends
 * when deriving the unread count.
 *
 * Avatars live on the wire too, in two places:
 *   - `PartnerInfo.AvatarId` for direct chats (same shape as `UserInfo.AvatarId`,
 *     see conarti/yandex-messenger-mcp docs/protocol-research.md §11.2);
 *   - `ChatInfo.AvatarUrl` for groups (carried the same way `ChatInfoDiff.AvatarUrl`
 *     notifies about avatar changes, §11.3).
 * Routing of `AvatarId` to a URL follows the client-side helper `E(avatarId, ...)`
 * from §12.2 of the same reference: yapic/mssngr public hosts vs messenger private
 * hosts depending on the avatarId namespace.
 */
import type {
    ExternalConversation,
    ExternalMediaKind,
    ExternalMessage,
    ExternalReaction
} from '@hapi/protocol'
import { microsToEpochMs, parseMicros } from './registry'
import { REACTION_EMOJI_BY_TYPE } from './reactionMap'

/** Hosts the Yandex avatar file URLs (§12.2 of the conarti reference). */
const YAPIC_AVATAR_HOST = 'avatars.mds.yandex.net'
const MESSENGER_PUBLIC_HOST = 'files.messenger.yandex.net'
const MESSENGER_PRIVATE_HOST = 'files.messenger.yandex.ru'

/**
 * Size used for the chat list chip. `islands-200` (200x200) is the canonical
 * yapic preset exposed by avatars.mds.yandex.net - empirically validated against
 * the live API (2026-09-27). We pick `islands-200` (not `islands-small`) because
 * retina / hi-dpi screens downscale a 200px image cleanly while a 50px one
 * looks blurry. File weight is ~9 KB which is still cheap.
 */
const AVATAR_CHAT_LIST_SIZE = 'islands-200'

/** AvatarId prefixes recognized by the client-side `E(...)` URL builder. */
const YAPIC_AVATAR_PREFIX = /^user_avatar\/yapic\/(.+)$/
const MSSNGR_AVATAR_PREFIX = /^user_avatar\/mssngr\/(.+)$/

/**
 * Builds a fetchable avatar URL from a Yandex AvatarId.
 *
 * The Yandex chats-web client prefixes avatarIds with the storage namespace. We
 * route them to the matching public-ish host so the browser can load the image
 * directly (CORS-OK for yapic/messenger public). For group/preview avatars that
 * never went through these prefixes, we fall back to the public messenger host
 * - the original URL is on `ChatInfo.AvatarUrl` anyway, so this branch is only
 * hit when an exotic `AvatarId` slips through, in which case a graceful miss is
 * better than a forced auth-cookie fetch that would break the chat-list render.
 *
 * Exported so the connector can reuse it for registry-driven avatar enrichment
 * (when the binary WS payload omits `PartnerInfo.AvatarId`).
 */
export function buildAvatarUrlFromId(avatarId: string): string {
    const yapic = YAPIC_AVATAR_PREFIX.exec(avatarId)
    if (yapic !== null) {
        return `https://${YAPIC_AVATAR_HOST}/get-yapic/${yapic[1]}/${AVATAR_CHAT_LIST_SIZE}`
    }
    const mssngr = MSSNGR_AVATAR_PREFIX.exec(avatarId)
    if (mssngr !== null) {
        return `https://${YAPIC_AVATAR_HOST}/get-mssngr/${mssngr[1]}/${AVATAR_CHAT_LIST_SIZE}`
    }
    return `https://${MESSENGER_PUBLIC_HOST}/${avatarId}?size=${AVATAR_CHAT_LIST_SIZE}`
}

/**
 * Normalizes an avatar URL that came pre-resolved from Yandex (typically on
 * `ChatInfo.AvatarUrl`). The wire format sometimes carries the dead `/SMALL48`
 * size alias even after we updated `AVATAR_CHAT_LIST_SIZE` to
 * `islands-200`. Rewrite the trailing path segment to the supported alias
 * so the rendered image actually resolves, and also promote any leftover
 * `islands-small` URLs (written by an earlier iteration of this code) to
 * `islands-200` so retina displays get a clean image. Returns the input
 * unchanged when it does not look like a yapic URL we recognise.
 */
export function normalizeAvatarUrl(url: string): string {
    if (!url.includes('avatars.mds.yandex.net')) return url
    if (url.includes('/SMALL48')) return url.replace(/\/SMALL48(?=$|\?)/, '/islands-200')
    if (url.includes('/islands-small')) return url.replace(/\/islands-small(?=$|\?)/, '/islands-200')
    return url
}

/**
 * Resolves the avatar URL for a chat element, or null when nothing is on the wire.
 *
 * Group chats have `ChatInfo.AvatarUrl` already as a full URL (returned by the
 * `history` payload), so we return it as-is. Direct/saved chats carry a
 * `PartnerInfo.AvatarId` namespace token that we map to a URL via the same
 * client-side rules used by `chats-web`.
 */
export function resolveChatAvatarUrl(raw: Record<string, unknown>): string | null {
    const chatInfo = asObject(raw['ChatInfo'])
    const directAvatarUrl = stringOr(chatInfo?.['AvatarUrl'])
    if (directAvatarUrl !== undefined) {
        return normalizeAvatarUrl(directAvatarUrl)
    }
    const partner = asObject(raw['PartnerInfo'])
    const partnerAvatarId = stringOr(partner?.['AvatarId'])
    if (partnerAvatarId !== undefined && partnerAvatarId.length > 0) {
        return buildAvatarUrlFromId(partnerAvatarId)
    }
    return null
}

export type AttachmentKind = 'image' | 'file' | 'voice' | 'sticker' | 'gallery_image'

export interface AttachmentRef {
    kind: AttachmentKind
    /** `FileInfo.Id2` — `<bucket>/<uuid>` document id for the download URL. */
    fileId: string
    name?: string
    size?: number
}

/** Internal message with everything the connector needs beyond the wire type. */
export interface YandexMessage {
    message: ExternalMessage
    attachments: AttachmentRef[]
    /** Reaction types this account has personally put on the message. */
    chosenReactionTypes: number[]
    micros: bigint
    /**
     * Resolved avatar URL of the sender (if `From.UserInfo.AvatarId` was on the
     * wire). The connector uses this to backfill `conversation.avatarDataUrl`
     * for direct chats where `PartnerInfo.AvatarId` is missing.
     */
    senderAvatarUrl?: string
}

export interface ChatShape {
    conversation: ExternalConversation
    lastMessage?: YandexMessage
    peerLastSeenSeqNo?: number
}

export function conversationId(remoteId: string): string {
    return `yandex:${remoteId}`
}

function asObject(value: unknown): Record<string, unknown> | undefined {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : undefined
}

function stringOr(value: unknown): string | undefined {
    return typeof value === 'string' && value.length > 0 ? value : undefined
}

function numberOr(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function countUnread(raw: Record<string, unknown>, messages: YandexMessage[]): number {
    const last = numberOr(raw['LastSeqNo']) ?? 0
    const seen = numberOr(raw['LastSeenByMeSeqNo']) ?? 0
    const outgoing = new Set(messages
        .filter(({ message }) => message.direction === 'outgoing'
            && message.seqNo !== undefined && message.seqNo > seen && message.seqNo <= last)
        .map(({ message }) => message.seqNo))
    return Math.max(0, last - seen - outgoing.size)
}

function attachmentRef(kind: AttachmentKind, fileInfo: unknown): AttachmentRef | undefined {
    const info = asObject(fileInfo)
    const fileId = stringOr(info?.['Id2'])
    if (!fileId) return undefined
    return {
        kind,
        fileId,
        ...(stringOr(info?.['Name']) !== undefined ? { name: stringOr(info?.['Name']) } : {}),
        ...(numberOr(info?.['Size']) !== undefined ? { size: numberOr(info?.['Size']) } : {})
    }
}

function extractAttachments(body: Record<string, unknown>): AttachmentRef[] {
    const refs: AttachmentRef[] = []
    const single = (key: string, kind: AttachmentKind): void => {
        const ref = attachmentRef(kind, asObject(body[key])?.['FileInfo'])
        if (ref) refs.push(ref)
    }
    single('Image', 'image')
    single('MiscFile', 'file')
    single('Voice', 'voice')
    refs.push(...extractStickerAttachment(body))
    const gallery = asObject(body['Gallery'])
    const items = Array.isArray(gallery?.['Items']) ? gallery?.['Items'] as unknown[] : []
    for (const item of items) {
        const ref = attachmentRef('gallery_image', asObject(asObject(item)?.['Image'])?.['FileInfo'])
        if (ref) refs.push(ref)
    }
    return refs
}

/**
 * Find a sticker attachment inside `plain` across the wire shapes observed for
 * Yandex Telemost. The conarti reference (§11.1) describes `Plain.Sticker` as
 * `{ Id, SetId }`; its concrete image path was captured in HAPI's own journal:
 *
 *     Plain.Sticker = { Id: "stickers/images/2509/28331.png", SetId: "2509" }
 *
 * `Id` is the relative path under `files.messenger.yandex.ru`; the host returns
 * a 301 redirect to the public `avatars.mds.yandex.net` URL for the same image.
 * Earlier guesses (FileInfo / Image.FileInfo / File.FileInfo) are kept as
 * fallbacks in case the wire ever changes again.
 *
 * Tried in order:
 *   1. `Sticker.Id` + `Sticker.SetId`         — live shape observed 2026-09-29
 *   2. `Sticker.FileInfo`                    — same pattern as Image / Voice
 *   3. `Sticker.Image.FileInfo`              — sticker wrapping an Image
 *   4. `Sticker.File.FileInfo`               — sticker wrapping a File
 *   5. `Sticker.Sticker.FileInfo`            — sticker wrapped in another Sticker
 */
function extractStickerAttachment(body: Record<string, unknown>): AttachmentRef[] {
    const sticker = asObject(body['Sticker'])
    if (!sticker) return []

    const live = liveStickerRef(sticker)
    if (live) return [live]

    const direct = attachmentRef('sticker', sticker['FileInfo'])
    if (direct) return [direct]

    const nestedImage = attachmentRef('sticker', asObject(sticker['Image'])?.['FileInfo'])
    if (nestedImage) return [nestedImage]

    const nestedFile = attachmentRef('sticker', asObject(sticker['File'])?.['FileInfo'])
    if (nestedFile) return [nestedFile]

    const nestedSticker = attachmentRef('sticker', asObject(sticker['Sticker'])?.['FileInfo'])
    if (nestedSticker) return [nestedSticker]

    const keys = Object.keys(sticker).sort().join(',')
    console.warn(`[Yandex connector] Plain.Sticker present but no Id/FileInfo found at known paths; keys=[${keys}] - update extractStickerAttachment once the real shape is captured`)
    return []
}

/**
 * Build a sticker attachment from the live `Id` + `SetId` shape. `Id` becomes
 * `fileId` so the existing `downloadMedia` path can serve it; `SetId` lands in
 * `name` (overloaded here — the field previously held the file name on
 * FileInfo-based attachments). The URL pattern used by `downloadMedia` is
 * documented at the call site.
 */
function liveStickerRef(sticker: Record<string, unknown>): AttachmentRef | undefined {
    const id = stringOr(sticker['Id'])
    if (!id) return undefined
    const setId = stringOr(sticker['SetId'])
    const ref: AttachmentRef = { kind: 'sticker', fileId: id }
    if (setId !== undefined) ref.name = setId
    return ref
}

function mediaKindFor(kind: AttachmentKind): ExternalMediaKind {
    switch (kind) {
        case 'image':
        case 'gallery_image':
            return 'image'
        case 'voice':
            return 'voice'
        case 'sticker':
            return 'sticker'
        default:
            return 'file'
    }
}

/**
 * Reactions live on the live `ServerMessage` — `Reactions`, `ReactionsVersion`,
 * `RecentUserReactions` — not on the wrapping history element (captured live
 * 2026-10-09). `source` is that `ServerMessage` object; `fallback` checks the
 * wrapping history element if present.
 */
function buildReactions(
    source: Record<string, unknown>,
    myGuid: string,
    fallback?: Record<string, unknown>
): { reactions: ExternalReaction[]; chosen: number[] } {
    const reactions: ExternalReaction[] = []
    const chosen: number[] = []
    const counts = new Map<number, number>()
    const rawAggregates = (Array.isArray(source['Reactions']) ? source['Reactions'] : fallback?.['Reactions']) as unknown[] | undefined
    const aggregates = Array.isArray(rawAggregates) ? rawAggregates : []
    for (const raw of aggregates) {
        const obj = asObject(raw)
        const type = numberOr(obj?.['Type'])
        if (type === undefined || counts.has(type)) continue
        counts.set(type, numberOr(obj?.['Count']) ?? 0)
    }
    const rawRecent = (Array.isArray(source['RecentUserReactions']) ? source['RecentUserReactions'] : fallback?.['RecentUserReactions']) as unknown[] | undefined
    const recent = Array.isArray(rawRecent) ? rawRecent : []
    const mineByType = new Set<number>()
    for (const raw of recent) {
        const obj = asObject(raw)
        const type = numberOr(obj?.['Type'])
        if (type === undefined) continue
        const actor = asObject(obj?.['UserInfo'])
        if (stringOr(actor?.['Guid']) === myGuid) mineByType.add(type)
    }
    for (const [type, count] of counts) {
        const emoji = REACTION_EMOJI_BY_TYPE[type] ?? null
        // The reaction key must match the Telegram connector's convention —
        // `emoji:<emoticon>` — because the web picker matches and echoes exactly
        // that string back. Types the map has never seen round-trip as `type:<n>`.
        const reaction = emoji !== null ? `emoji:${emoji}` : `type:${type}`
        reactions.push({ reaction, emoji, count: Math.max(1, count), chosen: mineByType.has(type) })
    }
    for (const type of mineByType) chosen.push(type)
    return { reactions, chosen }
}

/**
 * Text of a message body across the content shapes we render (§11.1). Shared by
 * the main `Plain` normalization and by forwarded/replied original payloads.
 */
function extractBodyText(body: Record<string, unknown>): string | undefined {
    return stringOr(asObject(body['Text'])?.['MessageText'])
        ?? stringOr(asObject(body['Voice'])?.['Text'])
        ?? stringOr(asObject(body['Gallery'])?.['Text'])
}

/**
 * `ServerMessage.ForwardedMessages` (§11.2): `{Payload, ServerMessageInfo}`
 * items carrying the original body behind a forward — and chats-web models replies
 * as forwards with a quote, so this is also where a reply's target surfaces.
 * The first item becomes HAPI's reply snapshot; later items (multi-forwards) are
 * not representable in the reply model and are ignored.
 */
function extractReplySnapshot(item: Record<string, unknown>): {
    providerMessageId: string
    senderName?: string
    text?: string
} | undefined {
    const forwarded = item['ForwardedMessages']
    if (!Array.isArray(forwarded) || forwarded.length === 0) return undefined
    const first = asObject(forwarded[0])
    const info = asObject(first?.['ServerMessageInfo'])
    let micros: bigint | undefined
    try {
        micros = info ? parseMicros(info['Timestamp']) : undefined
    } catch {
        micros = undefined
    }
    if (micros === undefined || micros <= 0n) {
        console.warn(`[Yandex connector] ForwardedMessages present but ServerMessageInfo.Timestamp missing; keys=[${Object.keys(first ?? {}).sort().join(',')}] - update extractReplySnapshot once the live shape is captured`)
        return undefined
    }
    const senderName = stringOr(asObject(info?.['From'])?.['DisplayName'])
    const payload = asObject(first?.['Payload'])
    const text = payload ? extractBodyText(payload) : undefined
    return {
        providerMessageId: micros.toString(),
        ...(senderName !== undefined ? { senderName } : {}),
        ...(text !== undefined && text.length > 0 ? { text } : {})
    }
}

/**
 * Normalizes one history message element `{ServerMessage, ...}` into a YandexMessage.
 * Returns undefined for elements that cannot be rendered: system events, deleted
 * messages, and bodies without any text or attachments.
 */
export function normalizeMessageItem(
    raw: unknown,
    myGuid: string,
    remoteChatId: string,
    peerLastSeenSeqNo?: number
): YandexMessage | undefined {
    const item = asObject(raw)
    if (!item) return undefined
    const source = asObject(item['ServerMessage'])
    const info = asObject(source?.['ServerMessageInfo'])
    const clientMessage = asObject(source?.['ClientMessage'])
    if (!source || !info || !clientMessage) return undefined
    if (info['Deleted'] === true) return undefined

    let micros: bigint
    try {
        micros = parseMicros(info['Timestamp'])
    } catch {
        return undefined
    }

    const plain = asObject(clientMessage['Plain']) ?? asObject(clientMessage['Ephemeral'])
    const system = plain === undefined ? asObject(clientMessage['SystemMessage']) : undefined
    if (system !== undefined || plain === undefined) return undefined

    const attachments = extractAttachments(plain)
    const text = extractBodyText(plain) ?? ''
    if (!text && attachments.length === 0 && plain['Poll'] === undefined && plain['Card'] === undefined) {
        return undefined
    }

    const from = asObject(info['From'])
    const senderGuid = stringOr(from?.['Guid']) ?? ''
    const outgoing = senderGuid === myGuid
    const seqNo = numberOr(info['SeqNo'])
    const version = numberOr(info['Version'])
    const lastEdit = numberOr(info['LastEditTimestamp'])
    const replySnapshot = extractReplySnapshot(source)

    const media = attachments.map((ref) => ({
        kind: mediaKindFor(ref.kind),
        mimeType: null,
        fileName: ref.name ?? null,
        size: ref.size ?? null,
        thumbnailDataUrl: null
    }))
    if (plain['Poll'] !== undefined || plain['Card'] !== undefined) {
        media.push({ kind: plain['Poll'] !== undefined ? 'poll' : 'other', mimeType: null, fileName: null, size: null, thumbnailDataUrl: null })
    }

    const { reactions, chosen } = buildReactions(source, myGuid, item)
    const conversationId = `yandex:${remoteChatId}`
    const providerMessageId = micros.toString()
    const message: ExternalMessage = {
        id: `${conversationId}:${providerMessageId}`,
        conversationId,
        providerMessageId,
        senderId: senderGuid || null,
        senderName: stringOr(from?.['DisplayName']) ?? null,
        direction: outgoing ? 'outgoing' : 'incoming',
        text,
        createdAt: microsToEpochMs(micros),
        editedAt: lastEdit !== undefined && lastEdit > 0 ? Math.trunc(lastEdit / 1000) : null,
        ...(outgoing
            ? {
                deliveryStatus: seqNo !== undefined && peerLastSeenSeqNo !== undefined && seqNo <= peerLastSeenSeqNo
                    ? 'read' as const
                    : 'sent' as const
            }
            : {}),
        ...(media.length > 0 ? { media } : {}),
        ...(reactions.length > 0 ? { reactions } : {}),
        ...(replySnapshot !== undefined ? {
            replyToProviderMessageId: replySnapshot.providerMessageId,
            ...(replySnapshot.senderName !== undefined ? { replyToSenderName: replySnapshot.senderName } : {}),
            ...(replySnapshot.text !== undefined ? { replyToText: replySnapshot.text } : {})
        } : {}),
        // `SeqNo`/`Version` are required for the read-receipt `SeenMarker` on
        // chats-web; only attach them when both are known to keep the schema
        // strictly optional for providers that don't surface them.
        ...(seqNo !== undefined ? { seqNo } : {}),
        ...(version !== undefined ? { version } : {})
    }

    // The wire shape puts the avatar under `From.UserInfo.AvatarId` for
    // direct chats. We resolve it here so the connector can backfill the
    // partner's avatar onto the conversation record in `loadMessages`.
    // Fall back to `From.AvatarId` (older shapes) and to a direct `AvatarUrl`
    // field if present.
    const senderUserInfo = asObject(from?.['UserInfo'])
    const senderAvatarId = stringOr(senderUserInfo?.['AvatarId'])
        ?? stringOr(asObject(from as Record<string, unknown>)?.['AvatarId'] as string)
    const senderAvatarUrlDirect = stringOr(asObject(from as Record<string, unknown>)?.['AvatarUrl'] as string)
    let senderAvatarUrl: string | undefined
    if (senderAvatarUrlDirect !== undefined && senderAvatarUrlDirect.length > 0) {
        senderAvatarUrl = senderAvatarUrlDirect
    } else if (senderAvatarId !== undefined && senderAvatarId.length > 0) {
        try {
            senderAvatarUrl = buildAvatarUrlFromId(senderAvatarId)
        } catch {
            senderAvatarUrl = undefined
        }
    }

    return {
        message,
        attachments,
        chosenReactionTypes: chosen,
        micros,
        ...(senderAvatarUrl !== undefined ? { senderAvatarUrl } : {})
    }
}

/**
 * Detects whether a Yandex chat id is a direct/saved chat (gate format
 * `<a>_<b>` with at least one side equal to `myGuid`) versus a group/channel
 * (slash-separated ids like `0/22/<uuid>`). Used to recover `kind` because the
 * binary `history` payload no longer carries `PrivateChatInfo` on the wire -
 * see /tmp/yandex-element-sample.json from 2026-09-27 and the live
 * `/api/messengers/yandex/candidates?refresh=true` dump (every direct chat
 * arrived as `kind=group` under the old logic, blocking the avatar fallback).
 */
export function isDirectChatId(remoteId: string, myGuid: string): boolean {
    if (!remoteId || !myGuid) return false
    const parts = remoteId.split('_', 2)
    if (parts.length !== 2) return false
    const [a, b] = parts
    if (!a || !b) return false
    if (a === myGuid && b === myGuid) return false
    return a === myGuid || b === myGuid
}

/**
 * Normalizes a history chat element. `withMessages` is the result of the same history
 * call: with Limit>=1 each element carries Messages whose last item is the newest.
 */
export function normalizeChatElement(raw: unknown, myGuid: string): ChatShape | undefined {
    const element = asObject(raw)
    const remoteChatId = stringOr(element?.['ChatId'])
    if (!element || !remoteChatId) return undefined

    const partner = asObject(element['PartnerInfo'])
    const partnerName = stringOr(partner?.['DisplayName']) ?? stringOr(partner?.['PublicName'])
    const groupName = stringOr(asObject(element['ChatInfo'])?.['Name'])

    // The saved-messages chat is the self gate `<myGuid>_<myGuid>`.
    const isSaved = remoteChatId === `${myGuid}_${myGuid}`
    const title = isSaved ? 'Избранное' : partnerName ?? groupName ?? 'Чат'

    // `PrivateChatInfo` is no longer present on the binary `history` payload,
    // so we recover the kind from the chat-id shape instead. Saved gate above;
    // anything else in `<guid>_<guid>` form with us on one side is a direct
    // chat; slash-separated ids (`0/22/...`) are group channels.
    const kind = isSaved
        ? 'saved'
        : isDirectChatId(remoteChatId, myGuid)
            ? 'direct'
            : 'group'
    const peerLastSeenSeqNo = numberOr(element['LastSeenSeqNo'])
    let lastMessageAt: number | null = null
    try {
        if (element['LastTsMcs'] !== undefined) lastMessageAt = microsToEpochMs(parseMicros(element['LastTsMcs']))
    } catch {
        lastMessageAt = null
    }

    const rawMessages = Array.isArray(element['Messages']) ? element['Messages'] as unknown[] : []
    const messages = rawMessages
        .map((entry) => normalizeMessageItem(entry, myGuid, remoteChatId, peerLastSeenSeqNo))
        .filter((entry): entry is YandexMessage => entry !== undefined)
    const last = messages[messages.length - 1]

    const conversation: ExternalConversation = {
        id: conversationId(remoteChatId),
        provider: 'yandex',
        remoteId: remoteChatId,
        title,
        kind,
        selected: false,
        lastMessageAt,
        lastMessagePreview: last
            ? (last.message.text || (last.message.media?.length ? attachmentPreview(last.attachments[0]?.kind) : ''))
            : null,
        lastMessageDirection: last?.message.direction,
        lastMessageDeliveryStatus: last?.message.deliveryStatus,
        unreadCount: isSaved ? 0 : countUnread(element, messages),
        avatarDataUrl: resolveChatAvatarUrl(element)
    }
    return { conversation, lastMessage: last, peerLastSeenSeqNo }
}

function attachmentPreview(kind: AttachmentKind | undefined): string {
    switch (kind) {
        case 'image':
        case 'gallery_image':
            return '🖼'
        case 'voice':
            return '🎤'
        case 'sticker':
            return '🙂'
        default:
            return '📎'
    }
}

/** Sorts messages oldest-first regardless of the server window order. */
export function sortMessagesAscending(messages: YandexMessage[]): YandexMessage[] {
    return [...messages].sort((a, b) => (a.micros < b.micros ? -1 : a.micros > b.micros ? 1 : 0))
}

/** Builds params for the single read method of the protocol: WS `history`. */
export function buildHistoryParams(input: {
    chatId?: string
    limit: number
    maxTimestamp?: bigint
    withChatData?: boolean
}): Record<string, unknown> {
    const params: Record<string, unknown> = { Limit: input.limit }
    if (input.chatId !== undefined) params['ChatId'] = input.chatId
    if (input.maxTimestamp !== undefined) params['MaxTimestamp'] = Number(input.maxTimestamp)
    if (input.withChatData === true) params['ChatDataFilter'] = {}
    return params
}
