import { extractAssistantPlainText, unwrapRoleWrappedRecordEnvelope } from '@hapi/protocol/messages'
import { isObject } from '@hapi/protocol'
import { decodeMessageContent } from './contentCodec'

/**
 * Message-content search corpus. Each indexed row keeps a lowercased plain-text
 * extract in `messages.search_text` (NULL for bookkeeping rows) so a chat
 * search is a cheap LIKE scan instead of a zstd-decompressing walk over the
 * whole table. "Final messages" only: the exact same extracts the chat renders
 * as human-readable text — user prompts and agent prose — never tool calls,
 * tool results, reasoning streams, or lifecycle events.
 */

/** Per-message index cap. Assistant output is already head+tail truncated at
 *  ingest; this only keeps pathological copies from bloating the column. */
export const MESSAGE_SEARCH_TEXT_LIMIT = 16 * 1024

export type MessageSearchDocument = {
    role: 'user' | 'agent'
    text: string
}

function extractChatText(value: unknown): string | null {
    if (typeof value === 'string') {
        const text = value.trim()
        return text.length > 0 ? text : null
    }

    if (Array.isArray(value)) {
        const text = value
            .flatMap((part) => {
                if (!isObject(part)) return []
                return typeof part.text === 'string' ? [part.text] : []
            })
            .join(' ')
            .trim()
        return text.length > 0 ? text : null
    }

    if (!isObject(value)) return null
    if ((value.type === 'text' || value.type === 'input_text') && typeof value.text === 'string') {
        const text = value.text.trim()
        return text.length > 0 ? text : null
    }

    return null
}

function extractUserText(content: unknown): string | null {
    if (Array.isArray(content)) {
        const text = content
            .flatMap((part) => {
                if (!isObject(part)) return []
                return (part.type === 'text' || part.type === 'input_text') && typeof part.text === 'string'
                    ? [part.text]
                    : []
            })
            .join('\n')
            .trim()
        return text.length > 0 ? text : null
    }

    return extractChatText(content)
}

/**
 * Plain-text search document for a stored message, or null when the row is
 * bookkeeping (tool traffic, events, reasoning snapshots). Mirrors
 * titleSuggestion's visibility gates: meta/compact-summary agent payloads are
 * excluded even when a plain extractor could parse them.
 */
export function extractMessageSearchDocument(content: unknown): MessageSearchDocument | null {
    const record = unwrapRoleWrappedRecordEnvelope(content)
    if (!record) return null

    if (record.role === 'user') {
        const text = extractUserText(record.content)
        return text ? { role: 'user', text } : null
    }

    if (record.role !== 'agent') return null

    const contentRecord = isObject(record.content) ? record.content : null
    const data = contentRecord && isObject(contentRecord.data) ? contentRecord.data : null
    if (data && (data.isMeta === true || data.isCompactSummary === true)) return null

    const rawText = extractAssistantPlainText(record.content) ?? extractChatText(record.content)
    const text = rawText?.trim()
    return text ? { role: 'agent', text } : null
}

/** Lowercased, length-capped value for the `search_text` column. */
export function toMessageSearchText(document: MessageSearchDocument | null): string | null {
    if (!document) return null
    const lowered = document.text.toLowerCase()
    return lowered.length > MESSAGE_SEARCH_TEXT_LIMIT ? lowered.slice(0, MESSAGE_SEARCH_TEXT_LIMIT) : lowered
}

/** Extract + lowercase in one step for insert paths. */
export function messageSearchText(content: unknown): string | null {
    return toMessageSearchText(extractMessageSearchDocument(content))
}

/** LIKE wildcards are matched literally — a user typing "%" means "%". */
export function escapeLikePattern(query: string): string {
    return query.replace(/[\\%_]/g, '\\$&')
}

export type MessageSearchSnippet = {
    snippet: string
    matchStart: number
    matchLength: number
}

/** Context window around the first match, with offsets into the snippet. */
export function buildSearchSnippet(text: string, queryLower: string, radius: number = 64): MessageSearchSnippet | null {
    if (!queryLower) return null
    const at = text.toLowerCase().indexOf(queryLower)
    if (at < 0) return null

    const start = Math.max(0, at - radius)
    const end = Math.min(text.length, at + queryLower.length + radius)
    return {
        snippet: text.slice(start, end),
        matchStart: at - start,
        matchLength: queryLower.length
    }
}
