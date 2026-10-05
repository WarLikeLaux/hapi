import { describe, expect, it } from 'vitest'
import { PingPeerError } from '@/modules/pingPeer/pingPeer'
import { parseInspectPeerArgs } from './inspectPeer'

describe('parseInspectPeerArgs', () => {
    it('parses session id and optional limit', () => {
        expect(parseInspectPeerArgs(['7d55ed21-8a9f-4309-b4f8-30069df36b4b', '--limit', '20'])).toEqual({
            help: false,
            sessionIdPrefix: '7d55ed21-8a9f-4309-b4f8-30069df36b4b',
            messageLimit: 20
        })
    })

    it('parses --limit= form and help', () => {
        expect(parseInspectPeerArgs(['--help'])).toEqual({ help: true })
        expect(parseInspectPeerArgs(['aaaa', '--limit=5']).messageLimit).toBe(5)
    })

    it('parses the older-page cursor flags in both forms', () => {
        expect(parseInspectPeerArgs([
            'aaaa',
            '--before-at', '1791210000000',
            '--before-seq', '1234'
        ])).toEqual({
            help: false,
            sessionIdPrefix: 'aaaa',
            beforeAt: 1791210000000,
            beforeSeq: 1234
        })
        expect(parseInspectPeerArgs(['aaaa', '--before-at=5', '--before-seq=6']).beforeAt).toBe(5)
        expect(parseInspectPeerArgs(['aaaa', '--before-at=5', '--before-seq=6']).beforeSeq).toBe(6)
    })

    it('rejects a half-specified cursor and non-numeric values', () => {
        expect(() => parseInspectPeerArgs(['aaaa', '--before-seq', '5'])).toThrow(PingPeerError)
        expect(() => parseInspectPeerArgs(['aaaa', '--before-at', '5'])).toThrow(PingPeerError)
        expect(() => parseInspectPeerArgs(['aaaa', '--before-at=abc', '--before-seq=1'])).toThrow(PingPeerError)
    })

    it('rejects unknown flags', () => {
        expect(() => parseInspectPeerArgs(['aaaa', '--resume'])).toThrow(PingPeerError)
    })
})
