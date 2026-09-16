import type { Database } from 'bun:sqlite'
import type { ExternalConversation, ExternalConversationKind, ExternalMessage, ExternalParticipant } from '@hapi/protocol'

type ConversationRow = {
    id: string
    provider: string
    remote_id: string
    title: string
    kind: ExternalConversationKind
    selected: number
    last_message_at: number | null
    last_message_preview: string | null
    last_message_direction: 'incoming' | 'outgoing' | null
    last_message_delivery_status: 'sent' | 'read' | null
    unread_count: number
    avatar_data_url: string | null
}

type MessageRow = {
    id: string
    conversation_id: string
    provider_message_id: string
    sender_id: string | null
    sender_name: string | null
    direction: 'incoming' | 'outgoing'
    text: string
    created_at: number
    edited_at: number | null
    delivery_status: 'sent' | 'read' | null
    media_json: string
}

function toConversation(row: ConversationRow): ExternalConversation {
    return {
        id: row.id,
        provider: row.provider,
        remoteId: row.remote_id,
        title: row.title,
        kind: row.kind,
        selected: row.selected === 1,
        lastMessageAt: row.last_message_at,
        lastMessagePreview: row.last_message_preview,
        lastMessageDirection: row.last_message_direction,
        lastMessageDeliveryStatus: row.last_message_delivery_status,
        unreadCount: row.unread_count,
        avatarDataUrl: row.avatar_data_url
    }
}

function toMessage(row: MessageRow): ExternalMessage {
    const message: ExternalMessage = {
        id: row.id,
        conversationId: row.conversation_id,
        providerMessageId: row.provider_message_id,
        senderId: row.sender_id,
        senderName: row.sender_name,
        direction: row.direction,
        text: row.text,
        createdAt: row.created_at,
        editedAt: row.edited_at,
        ...(row.delivery_status ? { deliveryStatus: row.delivery_status } : {}),
        media: JSON.parse(row.media_json) as ExternalMessage['media']
    }
    return message
}

function messagePreview(message: ExternalMessage): string {
    const text = message.text.trim()
    if (text) return text.slice(0, 160)
    const kind = message.media?.[0]?.kind
    if (!kind) return ''
    return ({
        image: 'Photo',
        video: 'Video',
        audio: 'Audio',
        voice: 'Voice message',
        sticker: 'Sticker',
        file: 'File',
        location: 'Location',
        contact: 'Contact',
        poll: 'Poll',
        other: 'Attachment'
    } satisfies Record<NonNullable<ExternalMessage['media']>[number]['kind'], string>)[kind]
}

export class MessengerStore {
    constructor(private readonly db: Database) {}

    private refreshConversationPreview(namespace: string, conversationId: string): void {
        const row = this.db.prepare(`
            SELECT id, conversation_id, provider_message_id, sender_id, sender_name,
                   direction, text, media_json, created_at, edited_at, delivery_status
            FROM external_messages
            WHERE namespace = ? AND conversation_id = ?
            ORDER BY created_at DESC,
                     CASE WHEN provider_message_id NOT GLOB '*[^0-9]*'
                          THEN CAST(provider_message_id AS INTEGER) END DESC,
                     provider_message_id DESC
            LIMIT 1
        `).get(namespace, conversationId) as MessageRow | undefined
        const message = row ? toMessage(row) : null
        this.db.prepare(`
            UPDATE external_conversations
            SET last_message_at = ?, last_message_preview = ?,
                last_message_direction = ?, last_message_delivery_status = ?
            WHERE namespace = ? AND id = ?
        `).run(
            message?.createdAt ?? null,
            message ? messagePreview(message) : null,
            message?.direction ?? null,
            message?.deliveryStatus ?? null,
            namespace,
            conversationId
        )
    }

    listConversations(namespace: string, selectedOnly = true): ExternalConversation[] {
        const rows = this.db.prepare(`
            SELECT id, provider, remote_id, title, kind, selected,
                   last_message_at, last_message_preview, last_message_direction,
                   last_message_delivery_status, unread_count, avatar_data_url
            FROM external_conversations
            WHERE namespace = ? ${selectedOnly ? 'AND selected = 1' : ''}
            ORDER BY COALESCE(last_message_at, 0) DESC, title COLLATE NOCASE
        `).all(namespace) as ConversationRow[]
        return rows.map(toConversation)
    }

    getConversation(namespace: string, id: string): ExternalConversation | null {
        const row = this.db.prepare(`
            SELECT id, provider, remote_id, title, kind, selected,
                   last_message_at, last_message_preview, last_message_direction,
                   last_message_delivery_status, unread_count, avatar_data_url
            FROM external_conversations WHERE namespace = ? AND id = ?
        `).get(namespace, id) as ConversationRow | undefined
        return row ? toConversation(row) : null
    }

    upsertConversation(namespace: string, conversation: ExternalConversation): void {
        this.db.prepare(`
            INSERT INTO external_conversations (
                id, namespace, provider, remote_id, title, kind, selected,
                last_message_at, last_message_preview, last_message_direction,
                last_message_delivery_status, unread_count, avatar_data_url
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(namespace, provider, remote_id) DO UPDATE SET
                title = excluded.title,
                kind = excluded.kind,
                last_message_at = COALESCE(excluded.last_message_at, external_conversations.last_message_at),
                last_message_preview = COALESCE(excluded.last_message_preview, external_conversations.last_message_preview),
                last_message_direction = CASE
                    WHEN excluded.last_message_at IS NOT NULL
                         AND (external_conversations.last_message_at IS NULL OR excluded.last_message_at >= external_conversations.last_message_at)
                        THEN excluded.last_message_direction
                    ELSE external_conversations.last_message_direction
                END,
                last_message_delivery_status = CASE
                    WHEN excluded.last_message_at IS NOT NULL
                         AND (external_conversations.last_message_at IS NULL OR excluded.last_message_at >= external_conversations.last_message_at)
                        THEN excluded.last_message_delivery_status
                    ELSE external_conversations.last_message_delivery_status
                END,
                unread_count = excluded.unread_count,
                avatar_data_url = CASE
                    WHEN excluded.avatar_data_url IS NULL THEN external_conversations.avatar_data_url
                    -- Telegram's stripped avatar is only a tiny blurred placeholder.
                    -- Never let it replace a full avatar retained from an earlier sync.
                    WHEN LENGTH(excluded.avatar_data_url) < 4096
                         AND LENGTH(external_conversations.avatar_data_url) >= 4096
                        THEN external_conversations.avatar_data_url
                    ELSE excluded.avatar_data_url
                END
        `).run(
            conversation.id,
            namespace,
            conversation.provider,
            conversation.remoteId,
            conversation.title,
            conversation.kind,
            conversation.selected ? 1 : 0,
            conversation.lastMessageAt,
            conversation.lastMessagePreview,
            conversation.lastMessageDirection ?? null,
            conversation.lastMessageDeliveryStatus ?? null,
            conversation.unreadCount,
            conversation.avatarDataUrl ?? null
        )
    }

    replaceSelection(namespace: string, provider: string, remoteIds: readonly string[]): void {
        this.db.transaction(() => {
            this.db.prepare(
                'UPDATE external_conversations SET selected = 0 WHERE namespace = ? AND provider = ?'
            ).run(namespace, provider)
            const select = this.db.prepare(`
                UPDATE external_conversations SET selected = 1
                WHERE namespace = ? AND provider = ? AND remote_id = ?
            `)
            for (const remoteId of remoteIds) {
                select.run(namespace, provider, remoteId)
            }
            if (remoteIds.length === 0) {
                this.db.prepare(
                    'DELETE FROM external_conversations WHERE namespace = ? AND provider = ?'
                ).run(namespace, provider)
            } else {
                const placeholders = remoteIds.map(() => '?').join(', ')
                this.db.prepare(`
                    DELETE FROM external_conversations
                    WHERE namespace = ? AND provider = ? AND remote_id NOT IN (${placeholders})
                `).run(namespace, provider, ...remoteIds)
            }
        })()
    }

    hasMessage(namespace: string, conversationId: string, providerMessageId: string): boolean {
        return Boolean(this.db.prepare(`
            SELECT 1 FROM external_messages
            WHERE namespace = ? AND conversation_id = ? AND provider_message_id = ?
        `).get(namespace, conversationId, providerMessageId))
    }

    setUnreadCount(namespace: string, conversationId: string, count: number): void {
        this.db.prepare(`
            UPDATE external_conversations SET unread_count = ?
            WHERE namespace = ? AND id = ?
        `).run(Math.max(0, Math.floor(count)), namespace, conversationId)
    }

    incrementUnreadCount(namespace: string, conversationId: string): void {
        this.db.prepare(`
            UPDATE external_conversations SET unread_count = unread_count + 1
            WHERE namespace = ? AND id = ?
        `).run(namespace, conversationId)
    }

    upsertMessage(namespace: string, message: ExternalMessage): void {
        this.db.transaction(() => {
            if (message.senderId && message.senderAvatarDataUrl) {
                this.db.prepare(`
                    INSERT INTO external_participants (
                        namespace, provider, remote_id, display_name, avatar_data_url
                    )
                    SELECT ?, provider, ?, ?, ?
                    FROM external_conversations
                    WHERE namespace = ? AND id = ?
                    ON CONFLICT(namespace, provider, remote_id) DO UPDATE SET
                        display_name = COALESCE(excluded.display_name, external_participants.display_name),
                        avatar_data_url = CASE
                            WHEN excluded.avatar_data_url IS NULL THEN external_participants.avatar_data_url
                            WHEN LENGTH(excluded.avatar_data_url) < 4096
                                 AND LENGTH(external_participants.avatar_data_url) >= 4096
                                THEN external_participants.avatar_data_url
                            ELSE excluded.avatar_data_url
                        END
                `).run(
                    namespace,
                    message.senderId,
                    message.senderName,
                    message.senderAvatarDataUrl,
                    namespace,
                    message.conversationId
                )
            }
            this.db.prepare(`
                INSERT INTO external_messages (
                    id, namespace, conversation_id, provider_message_id,
                    sender_id, sender_name, direction, text, media_json, created_at, edited_at,
                    delivery_status
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(namespace, conversation_id, provider_message_id) DO UPDATE SET
                    sender_id = excluded.sender_id,
                    sender_name = excluded.sender_name,
                    direction = excluded.direction,
                    text = excluded.text,
                    media_json = excluded.media_json,
                    created_at = excluded.created_at,
                    edited_at = excluded.edited_at,
                    delivery_status = excluded.delivery_status
            `).run(
                message.id,
                namespace,
                message.conversationId,
                message.providerMessageId,
                message.senderId,
                message.senderName,
                message.direction,
                message.text,
                JSON.stringify(message.media ?? []),
                message.createdAt,
                message.editedAt,
                message.deliveryStatus ?? null
            )
            this.db.prepare(`
                UPDATE external_conversations
                SET last_message_at = CASE
                        WHEN last_message_at IS NULL OR last_message_at <= ? THEN ?
                        ELSE last_message_at
                    END,
                    last_message_preview = CASE
                        WHEN last_message_at IS NULL OR last_message_at <= ? THEN ?
                        ELSE last_message_preview
                    END,
                    last_message_direction = CASE
                        WHEN last_message_at IS NULL OR last_message_at <= ? THEN ?
                        ELSE last_message_direction
                    END,
                    last_message_delivery_status = CASE
                        WHEN last_message_at IS NULL OR last_message_at <= ? THEN ?
                        ELSE last_message_delivery_status
                    END
                WHERE namespace = ? AND id = ?
            `).run(
                message.createdAt, message.createdAt,
                message.createdAt, messagePreview(message),
                message.createdAt, message.direction,
                message.createdAt, message.deliveryStatus ?? null,
                namespace, message.conversationId
            )
        })()
    }

    markOutgoingMessagesRead(namespace: string, conversationId: string, maxProviderMessageId: number): void {
        this.db.prepare(`
            UPDATE external_messages
            SET delivery_status = 'read'
            WHERE namespace = ? AND conversation_id = ? AND direction = 'outgoing'
              AND provider_message_id NOT GLOB '*[^0-9]*'
              AND CAST(provider_message_id AS INTEGER) <= ?
        `).run(namespace, conversationId, Math.max(0, Math.floor(maxProviderMessageId)))
        this.refreshConversationPreview(namespace, conversationId)
    }

    reconcileMessageSnapshot(namespace: string, conversationId: string, messages: ExternalMessage[]): void {
        this.db.transaction(() => {
            this.db.prepare(`
                DELETE FROM external_messages WHERE namespace = ? AND conversation_id = ?
            `).run(namespace, conversationId)
            for (const message of messages) this.upsertMessage(namespace, message)
            this.refreshConversationPreview(namespace, conversationId)
        })()
    }

    deleteMessages(
        namespace: string,
        provider: string,
        providerMessageIds: readonly string[],
        conversationId?: string
    ): string[] {
        if (providerMessageIds.length === 0) return []
        const placeholders = providerMessageIds.map(() => '?').join(', ')
        const conversationFilter = conversationId ? 'AND conversation_id = ?' : ''
        const params = conversationId
            ? [namespace, ...providerMessageIds, conversationId, namespace, provider]
            : [namespace, ...providerMessageIds, namespace, provider]
        return this.db.transaction(() => {
            const rows = this.db.prepare(`
                SELECT DISTINCT conversation_id FROM external_messages
                WHERE namespace = ? AND provider_message_id IN (${placeholders}) ${conversationFilter}
                  AND conversation_id IN (
                      SELECT id FROM external_conversations WHERE namespace = ? AND provider = ?
                  )
            `).all(...params) as Array<{ conversation_id: string }>
            this.db.prepare(`
                DELETE FROM external_messages
                WHERE namespace = ? AND provider_message_id IN (${placeholders}) ${conversationFilter}
                  AND conversation_id IN (
                      SELECT id FROM external_conversations WHERE namespace = ? AND provider = ?
                  )
            `).run(...params)
            const affected = rows.map((row) => row.conversation_id)
            for (const id of affected) this.refreshConversationPreview(namespace, id)
            return affected
        })()
    }

    listMessages(namespace: string, conversationId: string, limit = 100): ExternalMessage[] {
        const safeLimit = Math.min(200, Math.max(1, Math.floor(limit)))
        const rows = this.db.prepare(`
            SELECT id, conversation_id, provider_message_id, sender_id, sender_name,
                   direction, text, media_json, created_at, edited_at, delivery_status
            FROM external_messages
            WHERE namespace = ? AND conversation_id = ?
            ORDER BY created_at DESC,
                     CASE WHEN provider_message_id NOT GLOB '*[^0-9]*'
                          THEN CAST(provider_message_id AS INTEGER) END DESC,
                     provider_message_id DESC
            LIMIT ?
        `).all(namespace, conversationId, safeLimit) as MessageRow[]
        return rows.reverse().map(toMessage)
    }

    listParticipants(namespace: string, conversationId: string): ExternalParticipant[] {
        return this.db.prepare(`
            SELECT participants.remote_id AS id,
                   participants.display_name AS name,
                   participants.avatar_data_url AS avatarDataUrl
            FROM external_participants AS participants
            JOIN external_conversations AS conversations
              ON conversations.namespace = participants.namespace
             AND conversations.provider = participants.provider
            WHERE participants.namespace = ?
              AND conversations.id = ?
              AND EXISTS (
                  SELECT 1 FROM external_messages AS messages
                  WHERE messages.namespace = ?
                    AND messages.conversation_id = ?
                    AND messages.sender_id = participants.remote_id
              )
            ORDER BY participants.display_name COLLATE NOCASE, participants.remote_id
        `).all(namespace, conversationId, namespace, conversationId) as ExternalParticipant[]
    }
}
