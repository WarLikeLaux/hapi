/**
 * Xiva frame codec for the personal Yandex Messenger protocol (reverse-engineered
 * from chats-web, ported from the reference implementation in conarti/yandex-messenger-mcp).
 *
 * Frame layout: `0x01` + MessagePack `[serviceIndex, reqId, method]` + `0x05` + 11 zero
 * bytes + UTF-8 JSON. Only the msgpack header is msgpack; the body is plain JSON, so the
 * codec is hand-rolled: a library does not expose the byte offset where the header ends.
 *
 * CRITICAL: the header end is found by PARSED-LENGTH walking, never by scanning for the
 * `0x05` separator. A seq of exactly 5 encodes as the fixint `0x05` and would truncate
 * the header (confirmed empirically on a real push frame with seq=5).
 */

/** Separator of the data section: `0x05` + 11 zero bytes. The client always sends zeros. */
const DATA_SECTION_PREFIX_LENGTH = 12
const DATA_SECTION_MARKER = 0x05

const FIXARRAY_MASK = 0xf0
const FIXARRAY_TAG = 0x90

/* ---------- msgpack encode: only what the header needs ---------- */

function encodeUint(value: number): Buffer {
    if (!Number.isInteger(value) || value < 0) {
        throw new RangeError(`msgpack uint expects a non-negative integer, got ${value}`)
    }
    if (value < 0x80) return Buffer.from([value])
    if (value < 0x100) return Buffer.from([0xcc, value])
    if (value < 0x10000) return Buffer.from([0xcd, value >> 8, value & 0xff])
    const buffer = Buffer.alloc(5)
    buffer[0] = 0xce
    buffer.writeUInt32BE(value >>> 0, 1)
    return buffer
}

function encodeStr(value: string): Buffer {
    const body = Buffer.from(value, 'utf8')
    if (body.length < 0x20) return Buffer.concat([Buffer.from([0xa0 | body.length]), body])
    if (body.length < 0x100) return Buffer.concat([Buffer.from([0xd9, body.length]), body])
    const header = Buffer.alloc(3)
    header[0] = 0xda
    header.writeUInt16BE(body.length, 1)
    return Buffer.concat([header, body])
}

/* ---------- msgpack decode: advance by parsed length, never scan ---------- */

interface Decoded {
    value: number | string
    next: number
}

function decodeUint(buffer: Buffer, offset: number): Decoded {
    const tag = buffer[offset]
    if (tag === undefined) throw new RangeError(`msgpack uint: frame truncated at ${offset}`)
    if (tag < 0x80) return { value: tag, next: offset + 1 }
    if (tag === 0xcc) return { value: buffer.readUInt8(offset + 1), next: offset + 2 }
    if (tag === 0xcd) return { value: buffer.readUInt16BE(offset + 1), next: offset + 3 }
    if (tag === 0xce) return { value: buffer.readUInt32BE(offset + 1), next: offset + 5 }
    throw new RangeError(`msgpack: unknown uint type 0x${tag.toString(16)} at ${offset}`)
}

function decodeStr(buffer: Buffer, offset: number): Decoded {
    const tag = buffer[offset]
    if (tag === undefined) throw new RangeError(`msgpack str: frame truncated at ${offset}`)
    let length: number
    let start: number
    if ((tag & 0xe0) === 0xa0) {
        length = tag & 0x1f
        start = offset + 1
    } else if (tag === 0xd9) {
        length = buffer.readUInt8(offset + 1)
        start = offset + 2
    } else if (tag === 0xda) {
        length = buffer.readUInt16BE(offset + 1)
        start = offset + 3
    } else {
        throw new RangeError(`msgpack: unknown str type 0x${tag.toString(16)} at ${offset}`)
    }
    return { value: buffer.toString('utf8', start, start + length), next: start + length }
}

function decodeElement(buffer: Buffer, offset: number): Decoded {
    const tag = buffer[offset]
    if (tag === undefined) throw new RangeError(`msgpack: frame truncated at ${offset}`)
    if (tag < 0x80 || tag === 0xcc || tag === 0xcd || tag === 0xce) return decodeUint(buffer, offset)
    if ((tag & 0xe0) === 0xa0 || tag === 0xd9 || tag === 0xda) return decodeStr(buffer, offset)
    throw new RangeError(`msgpack: unknown element type 0x${tag.toString(16)} at ${offset}`)
}

/* ---------- frames ---------- */

export interface EncodeDataFrameOptions {
    /** Transport service index; always 0 in observed traffic. */
    serviceIndex: number
    /** Per-connection sequence counter; echoed back in the response. */
    reqId: number
    method: string
    /** Body `{RequestId, ...params}`; serialized as plain JSON, not msgpack. */
    payload: unknown
}

/** Builds an outgoing DATA frame; sent as a binary WebSocket message. */
export function encodeDataFrame(options: EncodeDataFrameOptions): Buffer {
    const header = Buffer.concat([
        Buffer.from([0x93]),
        encodeUint(options.serviceIndex),
        encodeUint(options.reqId),
        encodeStr(options.method)
    ])
    const dataSection = Buffer.alloc(DATA_SECTION_PREFIX_LENGTH)
    dataSection[0] = DATA_SECTION_MARKER
    return Buffer.concat([
        Buffer.from([0x01]),
        header,
        dataSection,
        Buffer.from(JSON.stringify(options.payload), 'utf8')
    ])
}

/** Frame byte 0. Defines the msgpack header arity. */
export const FrameType = {
    Data: 1,
    ProxyStatus: 2,
    Push: 3
} as const
export type FrameType = (typeof FrameType)[keyof typeof FrameType]

/** Parsed frame without interpretation: header elements as they came. */
export interface RawFrame {
    frameType: number
    elements: (number | string)[]
    headerEnd: number
    /** undefined for frames without a data section (e.g. PROXY_STATUS). */
    payload: unknown
}

/** Parses an incoming frame of any arity. */
export function decodeFrame(frame: Buffer): RawFrame {
    const frameType = frame[0]
    if (frameType === undefined) throw new RangeError('frame is empty')
    const arrayTag = frame[1]
    if (arrayTag === undefined || (arrayTag & FIXARRAY_MASK) !== FIXARRAY_TAG) {
        throw new RangeError(`frame header is not a fixarray: 0x${(arrayTag ?? 0).toString(16)}`)
    }

    const arity = arrayTag & 0x0f
    const elements: (number | string)[] = []
    let offset = 2
    for (let index = 0; index < arity; index += 1) {
        const decoded = decodeElement(frame, offset)
        elements.push(decoded.value)
        offset = decoded.next
    }

    const headerEnd = offset
    const jsonStart = headerEnd + DATA_SECTION_PREFIX_LENGTH
    const payload = jsonStart < frame.length
        ? JSON.parse(frame.toString('utf8', jsonStart, frame.length)) as unknown
        : undefined

    return { frameType, elements, headerEnd, payload }
}
