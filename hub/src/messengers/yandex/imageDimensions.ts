/**
 * Read pixel dimensions (width × height) from a raw image buffer.
 *
 * The Yandex Telemost fullscreen image viewer renders the image at the size
 * declared by the sender; if `Width`/`Height` are absent the viewer falls back
 * to a black placeholder, even though the file itself is reachable (miniatures
 * continue to work because they are sized server-side from the original bytes).
 * GIFs hit the same path - animation has no separate flag, the file extension
 * and the dimensions are all the receiver needs to play it.
 *
 * See `conarti/yandex-messenger-mcp docs/protocol-research.md §11.1`: the
 * outgoing `ClientMessage.Plain.Image` accepts optional `Width`/`Height` next
 * to `FileInfo`. The reference deliberately leaves them off because file_info
 * alone is enough for delivery - but the live fullscreen viewer needs them.
 *
 * Only the four formats Yandex accepts as inline images (JPEG, PNG, GIF, WebP)
 * have header-based dimension extraction; everything else returns undefined and
 * the caller skips the fields. SVGs (no fixed pixel size in the header) and
 * non-image attachments are intentionally not decoded.
 */

export interface ImageDimensions {
    width: number
    height: number
}

/** Mime types we know how to size from the header. */
const SUPPORTED_TYPES = new Set([
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/gif',
    'image/webp'
])

/** Parse width/height from the bytes of an image. Returns undefined when the format is unknown or the header is malformed. */
export function readImageDimensions(bytes: Uint8Array, mimeType: string): ImageDimensions | undefined {
    const normalized = mimeType.toLowerCase()
    if (!SUPPORTED_TYPES.has(normalized)) return undefined
    /* The smallest header we care about is the GIF LSD (6 bytes). Each format-specific
     * parser enforces its own minimum and bounds checks against `bytes.byteLength`. */
    if (bytes.byteLength < 6) return undefined

    switch (normalized) {
        case 'image/jpeg':
        case 'image/jpg':
            return readJpegDimensions(bytes)
        case 'image/png':
            return readPngDimensions(bytes)
        case 'image/gif':
            return readGifDimensions(bytes)
        case 'image/webp':
            return readWebpDimensions(bytes)
        default:
            return undefined
    }
}

/**
 * JPEG markers SOF0..SOF3, SOF5..SOF7, SOF9..SOF11, SOF13..SOF15 carry the
 * frame dimensions - 8 high-bits + 8 low-bits × 2, immediately after the
 * 2-byte segment length. SOF4/SOF8/SOF12 (DHT/JPG/DAAC) are skipped because
 * they do not describe the frame. SOI/EOI are framing and ignored.
 */
function readJpegDimensions(bytes: Uint8Array): ImageDimensions | undefined {
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined

    let offset = 2
    while (offset < bytes.byteLength - 9) {
        if (bytes[offset] !== 0xff) return undefined
        /* skip fill bytes (0xff padding between markers) */
        let marker = bytes[offset + 1]!
        while (marker === 0xff) {
            offset += 1
            if (offset + 1 >= bytes.byteLength) return undefined
            marker = bytes[offset + 1]!
        }
        offset += 2

        /* standalone markers without a length field */
        if (marker === 0xd8 /* SOI */ || marker === 0xd9 /* EOI */) continue

        if (offset + 1 >= bytes.byteLength) return undefined
        const segmentLength = (bytes[offset]! << 8) | bytes[offset + 1]!

        if (
            (marker >= 0xc0 && marker <= 0xc3) ||
            (marker >= 0xc5 && marker <= 0xc7) ||
            (marker >= 0xc9 && marker <= 0xcb) ||
            (marker >= 0xcd && marker <= 0xcf)
        ) {
            if (offset + 7 >= bytes.byteLength) return undefined
            const height = (bytes[offset + 3]! << 8) | bytes[offset + 4]!
            const width = (bytes[offset + 5]! << 8) | bytes[offset + 6]!
            if (width <= 0 || height <= 0) return undefined
            return { width, height }
        }

        /* SOS (0xda) marks the start of compressed data - the SOF must precede it */
        if (marker === 0xda) return undefined

        offset += segmentLength
    }
    return undefined
}

/**
 * PNG dimensions are in the first IHDR chunk at offset 16 (after the 8-byte
 * signature and the 4-byte length + 4-byte "IHDR" tag). Width/height are
 * 32-bit big-endian.
 */
function readPngDimensions(bytes: Uint8Array): ImageDimensions | undefined {
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
    for (let i = 0; i < signature.length; i += 1) {
        if (bytes[i] !== signature[i]) return undefined
    }
    if (bytes.byteLength < 24) return undefined
    if (bytes[12] !== 0x49 || bytes[13] !== 0x48 || bytes[14] !== 0x44 || bytes[15] !== 0x52) return undefined
    const width = readUint32Be(bytes, 16)
    const height = readUint32Be(bytes, 20)
    if (width <= 0 || height <= 0) return undefined
    if (width > 0xffff || height > 0xffff) return undefined
    return { width, height }
}

/**
 * GIF Logical Screen Descriptor exposes the canvas size at offset 6 (width)
 * and 8 (height), little-endian. Both GIF87a and GIF89a use the same layout.
 */
function readGifDimensions(bytes: Uint8Array): ImageDimensions | undefined {
    const header = String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!)
    if (header !== 'GIF8') return undefined
    if (bytes[4] !== 0x37 && bytes[4] !== 0x39) return undefined
    if (bytes[5] !== 0x61) return undefined
    if (bytes.byteLength < 10) return undefined
    const width = bytes[6]! | (bytes[7]! << 8)
    const height = bytes[8]! | (bytes[9]! << 8)
    if (width <= 0 || height <= 0) return undefined
    return { width, height }
}

/**
 * WebP RIFF container with a 'WEBP' fourcc and one of three sub-formats:
 *   - VP8  (lossy): 14-byte bitstream header, frame size at 26/28
 *   - VP8L (lossless): 1-byte signature + packed 14-bit width/height
 *   - VP8X (extended): 24-bit width/height minus 1
 * Anything else (animated WebP via ANIM/ANMF chunks shares VP8X dimensions).
 */
function readWebpDimensions(bytes: Uint8Array): ImageDimensions | undefined {
    /* The fourcc itself lives at offset 12 and tells us which parser to use, so the
     * container needs only 16 readable bytes here; the per-sub-format parsers then
     * enforce their own bounds (VP8L = 25, VP8 / VP8X = 30). */
    if (bytes.byteLength < 16) return undefined
    if (bytes[0] !== 0x52 || bytes[1] !== 0x49 || bytes[2] !== 0x46 || bytes[3] !== 0x46) return undefined
    if (bytes[8] !== 0x57 || bytes[9] !== 0x45 || bytes[10] !== 0x42 || bytes[11] !== 0x50) return undefined

    const fourcc = String.fromCharCode(bytes[12]!, bytes[13]!, bytes[14]!, bytes[15]!)
    if (fourcc === 'VP8 ') return readWebpVp8(bytes)
    if (fourcc === 'VP8L') return readWebpVp8L(bytes)
    if (fourcc === 'VP8X') return readWebpVp8X(bytes)
    return undefined
}

function readWebpVp8(bytes: Uint8Array): ImageDimensions | undefined {
    /* skip the 3-byte VP8 frame tag (0x9d 0x01 0x2a); the size sits after 3 more bytes of signature */
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return undefined
    const width = readUint16Le(bytes, 26) & 0x3fff
    const height = readUint16Le(bytes, 28) & 0x3fff
    if (width <= 0 || height <= 0) return undefined
    return { width, height }
}

function readWebpVp8L(bytes: Uint8Array): ImageDimensions | undefined {
    /* signature byte is 0x2f immediately after the fourcc; width/height are packed in the next 4 bytes */
    if (bytes[20] !== 0x2f) return undefined
    const b1 = bytes[21]!, b2 = bytes[22]!, b3 = bytes[23]!, b4 = bytes[24]!
    const width = 1 + (((b2 & 0x3f) << 8) | b1)
    const height = 1 + (((b4 & 0x0f) << 10) | (b3 << 2) | ((b2 & 0xc0) >> 6))
    if (width <= 0 || height <= 0) return undefined
    return { width, height }
}

function readWebpVp8X(bytes: Uint8Array): ImageDimensions | undefined {
    /* VP8X stores width-1 (24-bit LE) at offset 24 and height-1 at offset 27 */
    if (bytes.byteLength < 30) return undefined
    const width = 1 + (bytes[24]! | (bytes[25]! << 8) | (bytes[26]! << 16))
    const height = 1 + (bytes[27]! | (bytes[28]! << 8) | (bytes[29]! << 16))
    if (width <= 0 || height <= 0) return undefined
    return { width, height }
}

function readUint16Le(bytes: Uint8Array, offset: number): number {
    return bytes[offset]! | (bytes[offset + 1]! << 8)
}

function readUint32Be(bytes: Uint8Array, offset: number): number {
    return (
        (bytes[offset]! << 24) |
        (bytes[offset + 1]! << 16) |
        (bytes[offset + 2]! << 8) |
        bytes[offset + 3]!
    ) >>> 0
}
