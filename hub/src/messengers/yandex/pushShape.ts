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

/** `FileInfo.Source = 1` (DISK) — every file we send goes through `upload_to_disk` (§12.1). */
const FILE_SOURCE_DISK = 1

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
}

export interface FileClientMessageInput extends FileInfoInput {
    chatId: string
    payloadId: string
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
            MiscFile: {
                FileInfo: buildFileInfo(input)
            }
        }
    }
}
