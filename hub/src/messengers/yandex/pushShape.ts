/**
 * Outgoing `ClientMessage.Plain` builders for the Yandex chats-web protocol.
 *
 * The reference project `conarti/yandex-messenger-mcp` documents the wire shape in
 * `docs/protocol-research.md §11.1`. Our `shapes.ts` covers the read side; this
 * file covers the write side so send-time mutations stay symmetric and unit-testable.
 *
 * Only `Image` and `MiscFile` are needed today; text and reactions are inline at
 * their respective call sites. Add new builders here as the connector grows rather
 * than open-coding the wire shape in `yandexConnector.ts`.
 */

import { readImageDimensions } from './imageDimensions'
import { toWireTimestamp } from './registry'

/** `FileInfo.Source = 1` (DISK) — every file we send goes through `upload_to_disk` (§12.1). */
const FILE_SOURCE_DISK = 1

/** Cap for the quoted reply fragment; the wire type is a free-form string (§11.1). */
const REPLY_QUOTE_MAX_CHARS = 120

export interface FileInfoInput {
    /** `<bucket>/<uuid>` returned by `add_files`. Goes into `FileInfo.Id2`. */
    fileId: string
    /** Original user-facing filename. Goes into `FileInfo.Name`. */
    fileName: string
    /** Byte length on the wire. Goes into `FileInfo.Size`. */
    size: number
}

export interface ImageClientMessageInput extends FileInfoInput {
    chatId: string
    /** Client-side id; reused on retries for server-side dedup. */
    payloadId: string
    /** Raw bytes used to derive `Width`/`Height`. Dimensions are omitted when unreadable. */
    bytes: Uint8Array
    mimeType: string
    /** Send this media as a reply: micros provider id of the quoted message. */
    replyToProviderMessageId?: string
    /** Quoted fragment shown above the reply; resolved by the caller from its snapshot. */
    replyQuoteText?: string
}

export interface FileClientMessageInput extends FileInfoInput {
    chatId: string
    payloadId: string
    replyToProviderMessageId?: string
    replyQuoteText?: string
}

/** `FileInfo` (§11.1): `Id2` + `Name` + `Size` + `Source=1`. No URL, no bucket. */
function buildFileInfo(input: FileInfoInput): Record<string, unknown> {
    return {
        Id2: input.fileId,
        Name: input.fileName,
        Size: input.size,
        Source: FILE_SOURCE_DISK
    }
}

/**
 * Forward fields that mark a `Plain` as a reply (§11.1): chats-web models replies
 * as forwards with a quote, so the mutation carries `ForwardedMessageRefs`
 * (`{ChatId, Timestamp}` addressing the original message; `Timestamp` is numeric
 * microseconds — a string makes the backend answer BACKEND_CALL_ERROR) plus
 * `ForwardedMessageStyles[].Quote`, the fragment the official client renders
 * above the reply. Returns `{}` when no reply target is given, so callers can
 * spread the result unconditionally. `replyToProviderMessageId` must be a numeric
 * provider id (microseconds) — anything else is a caller bug and throws.
 */
export function buildReplyFields(
    chatId: string,
    replyToProviderMessageId: string | undefined,
    quoteText: string | undefined
): Record<string, unknown> {
    if (replyToProviderMessageId === undefined || replyToProviderMessageId.length === 0) return {}
    const timestamp = toWireTimestamp(BigInt(replyToProviderMessageId))
    const quote = quoteText?.trim()
    return {
        ForwardedMessageRefs: [{ ChatId: chatId, Timestamp: timestamp }],
        ...(quote !== undefined && quote.length > 0
            ? { ForwardedMessageStyles: [{ Quote: quote.slice(0, REPLY_QUOTE_MAX_CHARS) }] }
            : {})
    }
}

/**
 * Build the outgoing `ClientMessage.Plain.Image` envelope.
 *
 * `Width`/`Height` are attached when the bytes carry a parseable header (JPEG, PNG,
 * GIF, WebP). Without them the Telemost fullscreen viewer falls back to a black
 * placeholder even though the file is reachable; the server-side miniature keeps
 * working either way. Omitting the fields for formats without header dimensions
 * (SVG, AVIF) is safe - the same path is used by messages we did not send.
 */
export function buildImageClientMessage(input: ImageClientMessageInput): Record<string, unknown> {
    const dimensions = readImageDimensions(input.bytes, input.mimeType)
    return {
        Plain: {
            ChatId: input.chatId,
            PayloadId: input.payloadId,
            ...buildReplyFields(input.chatId, input.replyToProviderMessageId, input.replyQuoteText),
            Image: {
                ...(dimensions !== undefined ? { Width: dimensions.width, Height: dimensions.height } : {}),
                FileInfo: buildFileInfo(input)
            }
        }
    }
}

/** Build the outgoing `ClientMessage.Plain.MiscFile` envelope for non-image attachments. */
export function buildFileClientMessage(input: FileClientMessageInput): Record<string, unknown> {
    return {
        Plain: {
            ChatId: input.chatId,
            PayloadId: input.payloadId,
            ...buildReplyFields(input.chatId, input.replyToProviderMessageId, input.replyQuoteText),
            MiscFile: {
                FileInfo: buildFileInfo(input)
            }
        }
    }
}
