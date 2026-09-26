import { describe, expect, it } from 'bun:test'
import { decodeFrame, encodeDataFrame, FrameType } from './frameCodec'

describe('xiva frame codec', () => {
    it('round-trips a DATA frame', () => {
        const payload = { RequestId: 'abcd1234-aaaa-bbbb-cccc-12345678', Limit: 50 }
        const frame = encodeDataFrame({ serviceIndex: 0, reqId: 7, method: 'history', payload })
        const decoded = decodeFrame(frame)
        expect(decoded.frameType).toBe(FrameType.Data)
        expect(decoded.elements).toEqual([0, 7, 'history'])
        expect(decoded.payload).toEqual(payload)
    })

    it('does not truncate the header when the seq byte is 0x05', () => {
        // A seq of 5 encodes as the raw fixint 0x05 — the same byte as the data-section
        // marker. Parsing must walk parsed lengths, not scan for 0x05.
        const payload = { RequestId: 'r', Request: 'push' }
        const frame = encodeDataFrame({ serviceIndex: 0, reqId: 5, method: 'push', payload })
        const decoded = decodeFrame(frame)
        expect(decoded.elements).toEqual([0, 5, 'push'])
        expect(decoded.payload).toEqual(payload)
    })

    it('round-trips a short seq and an extended-length method name', () => {
        const short = encodeDataFrame({ serviceIndex: 0, reqId: 1, method: 'ok', payload: {} })
        expect(decodeFrame(short).elements).toEqual([0, 1, 'ok'])

        const longMethod = 'm'.repeat(40)
        const extended = encodeDataFrame({ serviceIndex: 3, reqId: 70000, method: longMethod, payload: { a: 1 } })
        expect(decodeFrame(extended).elements).toEqual([3, 70000, longMethod])

        const veryLongMethod = 'n'.repeat(300)
        const wide = encodeDataFrame({ serviceIndex: 0, reqId: 2, method: veryLongMethod, payload: null })
        expect(decodeFrame(wide).elements).toEqual([0, 2, veryLongMethod])
        expect(decodeFrame(wide).payload).toBeNull()
    })

    it('parses a PROXY_STATUS frame with no data section', () => {
        const frame = Buffer.concat([
            Buffer.from([0x02, 0x92]),
            Buffer.from([0x07]),        // reqId 7
            Buffer.from([0x06])         // errorCode 6 SERVICE_UNAVAILABLE
        ])
        const decoded = decodeFrame(frame)
        expect(decoded.frameType).toBe(FrameType.ProxyStatus)
        expect(decoded.elements).toEqual([7, 6])
        expect(decoded.payload).toBeUndefined()
    })

    it('parses a PUSH frame with string elements', () => {
        // 0x03 + fixarray [uid, service, event]
        const frame = Buffer.from([
            0x03, 0x93,
            0xa3, 0x31, 0x32, 0x33,                 // '123'
            0xa9, ...Buffer.from('messenger', 'utf8'),
            0xa4, 0x70, 0x75, 0x73, 0x68            // 'push'
        ])
        const decoded = decodeFrame(frame)
        expect(decoded.frameType).toBe(FrameType.Push)
        expect(decoded.elements).toEqual(['123', 'messenger', 'push'])
        expect(decoded.payload).toBeUndefined()
    })

    it('rejects malformed frames', () => {
        expect(() => decodeFrame(Buffer.alloc(0))).toThrow()
        expect(() => decodeFrame(Buffer.from([0x01, 0x05]))).toThrow()
    })
})
