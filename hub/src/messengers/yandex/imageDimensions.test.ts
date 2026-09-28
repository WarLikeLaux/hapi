import { describe, expect, it } from 'bun:test'
import { readImageDimensions } from './imageDimensions'

/* PNG IHDR chunk helper - builds a minimal 8-byte signature + IHDR. */
function pngBytes(width: number, height: number): Uint8Array {
    const out = new Uint8Array(8 + 8 + 13)
    /* PNG signature */
    out.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
    /* IHDR length = 13, big-endian */
    out.set([0x00, 0x00, 0x00, 0x0d], 8)
    /* 'IHDR' tag */
    out.set([0x49, 0x48, 0x44, 0x52], 12)
    /* width and height, big-endian */
    out[16] = (width >>> 24) & 0xff
    out[17] = (width >>> 16) & 0xff
    out[18] = (width >>> 8) & 0xff
    out[19] = width & 0xff
    out[20] = (height >>> 24) & 0xff
    out[21] = (height >>> 16) & 0xff
    out[22] = (height >>> 8) & 0xff
    out[23] = height & 0xff
    /* bit depth, color type, compression, filter, interlace - left as 0/0/0/0/0 */
    return out
}

/**
 * Build a JPEG with a single SOF0 segment carrying the requested dimensions.
 * The segment layout: SOI (2) + marker (2) + segment length (2) + payload...
 * SOF0 payload starts with sample precision (1 byte), then height (2 BE),
 * width (2 BE), then component data (which we leave empty).
 */
function jpegBytes(width: number, height: number): Uint8Array {
    const payloadLength = 1 + 2 + 2 + 3
    const segmentLength = 2 + payloadLength
    const out = new Uint8Array(2 + 2 + segmentLength)
    let i = 0
    /* SOI */
    out[i++] = 0xff
    out[i++] = 0xd8
    /* SOF0 marker */
    out[i++] = 0xff
    out[i++] = 0xc0
    /* segment length, big-endian */
    out[i++] = (segmentLength >>> 8) & 0xff
    out[i++] = segmentLength & 0xff
    /* sample precision */
    out[i++] = 8
    /* height, big-endian */
    out[i++] = (height >>> 8) & 0xff
    out[i++] = height & 0xff
    /* width, big-endian */
    out[i++] = (width >>> 8) & 0xff
    out[i++] = width & 0xff
    /* components: 1 component with id 1, sampling 1x1, quant table 0 */
    out[i++] = 1
    out[i++] = 0x11
    out[i++] = 0
    return out
}

/** Build a minimal GIF89a with the requested canvas size. */
function gifBytes(width: number, height: number): Uint8Array {
    const out = new Uint8Array(13)
    out[0] = 0x47 /* G */
    out[1] = 0x49 /* I */
    out[2] = 0x46 /* F */
    out[3] = 0x38 /* 8 */
    out[4] = 0x39 /* 9 */
    out[5] = 0x61 /* a */
    out[6] = width & 0xff
    out[7] = (width >>> 8) & 0xff
    out[8] = height & 0xff
    out[9] = (height >>> 8) & 0xff
    out[10] = 0 /* packed: no global color table */
    out[11] = 0 /* background color index */
    out[12] = 0 /* pixel aspect ratio */
    return out
}

/** Build a minimal WebP VP8X container. Width/height are stored minus 1. */
function webpVp8xBytes(width: number, height: number): Uint8Array {
    const out = new Uint8Array(30)
    out[0] = 0x52 /* R */
    out[1] = 0x49 /* I */
    out[2] = 0x46 /* F */
    out[3] = 0x46 /* F */
    /* file size (little-endian) at offset 4 */
    out[4] = 0x16
    out[5] = 0
    out[6] = 0
    out[7] = 0
    out[8] = 0x57 /* W */
    out[9] = 0x45 /* E */
    out[10] = 0x42 /* B */
    out[11] = 0x50 /* P */
    out[12] = 0x56 /* V */
    out[13] = 0x50 /* P */
    out[14] = 0x38 /* 8 */
    out[15] = 0x58 /* X */
    out[16] = 10 /* chunk size */
    out[17] = 0
    out[18] = 0
    out[19] = 0
    out[20] = 0 /* flags */
    out[21] = 0
    out[22] = 0
    out[23] = 0
    const widthMinusOne = width - 1
    const heightMinusOne = height - 1
    out[24] = widthMinusOne & 0xff
    out[25] = (widthMinusOne >>> 8) & 0xff
    out[26] = (widthMinusOne >>> 16) & 0xff
    out[27] = heightMinusOne & 0xff
    out[28] = (heightMinusOne >>> 8) & 0xff
    out[29] = (heightMinusOne >>> 16) & 0xff
    return out
}

/** Build a minimal WebP VP8 (lossy) frame. Width/height live at offsets 26/28. */
function webpVp8Bytes(width: number, height: number): Uint8Array {
    const out = new Uint8Array(30)
    out[0] = 0x52
    out[1] = 0x49
    out[2] = 0x46
    out[3] = 0x46
    out[4] = 0x16
    out[5] = 0
    out[6] = 0
    out[7] = 0
    out[8] = 0x57
    out[9] = 0x45
    out[10] = 0x42
    out[11] = 0x50
    out[12] = 0x56
    out[13] = 0x50
    out[14] = 0x38
    out[15] = 0x20 /* ' ' */
    out[23] = 0x9d
    out[24] = 0x01
    out[25] = 0x2a
    /* horizontal_size_code is 14 bits at offset 26 (lower 14 bits) */
    out[26] = width & 0xff
    out[27] = (width >>> 8) & 0x3f
    /* vertical_size_code at offset 28 */
    out[28] = height & 0xff
    out[29] = (height >>> 8) & 0x3f
    return out
}

/** Build a minimal WebP VP8L (lossless) frame with packed 14-bit dimensions. */
function webpVp8lBytes(width: number, height: number): Uint8Array {
    const out = new Uint8Array(25)
    out[0] = 0x52
    out[1] = 0x49
    out[2] = 0x46
    out[3] = 0x46
    out[4] = 0x11
    out[5] = 0
    out[6] = 0
    out[7] = 0
    out[8] = 0x57
    out[9] = 0x45
    out[10] = 0x42
    out[11] = 0x50
    out[12] = 0x56
    out[13] = 0x50
    out[14] = 0x38
    out[15] = 0x4c /* L */
    out[20] = 0x2f /* signature byte */
    const wMinusOne = width - 1
    const hMinusOne = height - 1
    /* VP8L packs width-1 into 14 bits and height-1 into 14 bits across bytes 21..24 */
    out[21] = wMinusOne & 0xff
    out[22] = ((wMinusOne >>> 8) & 0x3f) | ((hMinusOne & 0x03) << 6)
    out[23] = (hMinusOne >>> 2) & 0xff
    out[24] = (hMinusOne >>> 10) & 0x0f
    return out
}

describe('readImageDimensions', () => {
    it('reads PNG width and height from the IHDR chunk', () => {
        expect(readImageDimensions(pngBytes(1920, 1080), 'image/png')).toEqual({ width: 1920, height: 1080 })
    })

    it('reads JPEG width and height from a SOF0 segment', () => {
        expect(readImageDimensions(jpegBytes(640, 480), 'image/jpeg')).toEqual({ width: 640, height: 480 })
    })

    it('treats image/jpg the same as image/jpeg', () => {
        expect(readImageDimensions(jpegBytes(320, 200), 'image/jpg')).toEqual({ width: 320, height: 200 })
    })

    it('reads GIF dimensions from the logical screen descriptor', () => {
        expect(readImageDimensions(gifBytes(480, 270), 'image/gif')).toEqual({ width: 480, height: 270 })
    })

    it('also accepts the GIF87a header', () => {
        const bytes = gifBytes(120, 80)
        bytes[4] = 0x37 /* '7' */
        expect(readImageDimensions(bytes, 'image/gif')).toEqual({ width: 120, height: 80 })
    })

    it('reads WebP VP8X (extended / animated) dimensions', () => {
        expect(readImageDimensions(webpVp8xBytes(800, 600), 'image/webp')).toEqual({ width: 800, height: 600 })
    })

    it('reads WebP VP8 (lossy) dimensions', () => {
        expect(readImageDimensions(webpVp8Bytes(1024, 768), 'image/webp')).toEqual({ width: 1024, height: 768 })
    })

    it('reads WebP VP8L (lossless) dimensions', () => {
        expect(readImageDimensions(webpVp8lBytes(640, 360), 'image/webp')).toEqual({ width: 640, height: 360 })
    })

    it('returns undefined for unsupported mime types', () => {
        expect(readImageDimensions(pngBytes(10, 10), 'image/svg+xml')).toBeUndefined()
        expect(readImageDimensions(pngBytes(10, 10), 'application/pdf')).toBeUndefined()
        expect(readImageDimensions(pngBytes(10, 10), 'image/avif')).toBeUndefined()
    })

    it('returns undefined for too-short buffers', () => {
        expect(readImageDimensions(new Uint8Array(4), 'image/png')).toBeUndefined()
        expect(readImageDimensions(new Uint8Array(0), 'image/jpeg')).toBeUndefined()
    })

    it('returns undefined when the PNG signature does not match', () => {
        const bytes = pngBytes(100, 50)
        bytes[0] = 0x00
        expect(readImageDimensions(bytes, 'image/png')).toBeUndefined()
    })

    it('returns undefined when the JPEG does not start with SOI', () => {
        const bytes = jpegBytes(100, 50)
        bytes[0] = 0x00
        expect(readImageDimensions(bytes, 'image/jpeg')).toBeUndefined()
    })

    it('returns undefined when the JPEG has no SOF segment before SOS', () => {
        /* SOI + DQT marker with no dimensions */
        const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x04, 0x00, 0x00, 0xff, 0xda])
        expect(readImageDimensions(bytes, 'image/jpeg')).toBeUndefined()
    })

    it('returns undefined when the GIF magic is wrong', () => {
        const bytes = gifBytes(100, 50)
        bytes[0] = 0x41
        expect(readImageDimensions(bytes, 'image/gif')).toBeUndefined()
    })

    it('returns undefined when the WebP RIFF magic is wrong', () => {
        const bytes = webpVp8xBytes(100, 50)
        bytes[0] = 0x41
        expect(readImageDimensions(bytes, 'image/webp')).toBeUndefined()
    })

    it('returns undefined when the WebP sub-format is unrecognized', () => {
        const bytes = webpVp8xBytes(100, 50)
        bytes[12] = 0x41 /* overwrite 'V' */
        expect(readImageDimensions(bytes, 'image/webp')).toBeUndefined()
    })

    it('matches mime types case-insensitively', () => {
        expect(readImageDimensions(pngBytes(20, 30), 'Image/PNG')).toEqual({ width: 20, height: 30 })
    })
})
