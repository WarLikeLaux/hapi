import type { Database } from 'bun:sqlite'
import type { ExternalConversation, ExternalConversationKind, ExternalMessage } from '@hapi/protocol'

type ConversationRow = {
    id: string
    provider: string
    remote_id: string
    title: string
    kind: ExternalConversationKind
    selected: number
    last_message_at: number | null
    last_message_preview: string | null
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
        unreadCount: row.unread_count,
        avatarDataUrl: row.avatar_data_url
    }
}

function toMessage(row: MessageRow): ExternalMessage {
    return {
        id: row.id,
        conversationId: row.conversation_id,
        providerMessageId: row.provider_message_id,
        senderId: row.sender_id,
        senderName: row.sender_name,
        direction: row.direction,
        text: row.text,
        createdAt: row.created_at,
        editedAt: row.edited_at,
        media: JSON.parse(row.media_json) as ExternalMessage['media']
    }
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

    listConversations(namespace: string, selectedOnly = true): ExternalConversation[] {
        const rows = this.db.prepare(`
            SELECT id, provider, remote_id, title, kind, selected,
                   last_message_at, last_message_preview, unread_count, avatar_data_url
            FROM external_conversations
            WHERE namespace = ? ${selectedOnly ? 'AND selected = 1' : ''}
            ORDER BY COALESCE(last_message_at, 0) DESC, title COLLATE NOCASE
        `).all(namespace) as ConversationRow[]
        return rows.map(toConversation)
    }

    getConversation(namespace: string, id: string): ExternalConversation | null {
        const row = this.db.prepare(`
            SELECT id, provider, remote_id, title, kind, selected,
                   last_message_at, last_message_preview, unread_count, avatar_data_url
            FROM external_conversations WHERE namespace = ? AND id = ?
        `).get(namespace, id) as ConversationRow | undefined
        return row ? toConversation(row) : null
    }

    upsertConversation(namespace: string, conversation: ExternalConversation): void {
        this.db.prepare(`
            INSERT INTO external_conversations (
                id, namespace, provider, remote_id, title, kind, selected,
                last_message_at, last_message_preview, unread_count, avatar_data_url
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(namespace, provider, remote_id) DO UPDATE SET
                title = excluded.title,
                kind = excluded.kind,
                last_message_at = COALESCE(excluded.last_message_at, external_conversations.last_message_at),
                last_message_preview = COALESCE(excluded.last_message_preview, external_conversations.last_message_preview),
                unread_count = excluded.unread_count,
                avatar_data_url = COALESCE(excluded.avatar_data_url, external_conversations.avatar_data_url)
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

    upsertMessage(namespace: string, message: ExternalMessage): void {
        this.db.transaction(() => {
            this.db.prepare(`
                INSERT INTO external_messages (
                    id, namespace, conversation_id, provider_message_id,
                    sender_id, sender_name, direction, text, media_json, created_at, edited_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(namespace, conversation_id, provider_message_id) DO UPDATE SET
                    sender_id = excluded.sender_id,
                    sender_name = excluded.sender_name,
                    direction = excluded.direction,
                    text = excluded.text,
                    media_json = excluded.media_json,
                    created_at = excluded.created_at,
                    edited_at = excluded.edited_at
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
                message.editedAt
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
                    END
                WHERE namespace = ? AND id = ?
            `).run(message.createdAt, message.createdAt, message.createdAt, messagePreview(message), namespace, message.conversationId)
        })()
    }

    listMessages(namespace: string, conversationId: string, limit = 100): ExternalMessage[] {
        const safeLimit = Math.min(200, Math.max(1, Math.floor(limit)))
        const rows = this.db.prepare(`
            SELECT id, conversation_id, provider_message_id, sender_id, sender_name,
                   direction, text, media_json, created_at, edited_at
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
}
