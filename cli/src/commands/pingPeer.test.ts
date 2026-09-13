import { describe, expect, it } from 'vitest'
import { PingPeerError } from '@/modules/pingPeer/pingPeer'
import { parsePingPeerArgs } from './pingPeer'

describe('parsePingPeerArgs', () => {
    it('parses positional prefix + message', () => {
        expect(parsePingPeerArgs(['05d9f0f2', 'hello'])).toEqual({
            help: false,
            list: false,
            sessionIdPrefix: '05d9f0f2',
            message: 'hello'
        })
    })

    it('parses --message-file, --local-id, and --wait', () => {
        expect(parsePingPeerArgs([
            'abc',
            '--message-file',
            'brief.md',
            '--local-id',
            'wake-42',
            '--wait',
            '30'
        ])).toEqual({
            help: false,
            list: false,
            sessionIdPrefix: 'abc',
            messageFile: 'brief.md',
            localId: 'wake-42',
            waitActiveSecs: 30
        })
    })

    it('rejects an empty --local-id', () => {
        expect(() => parsePingPeerArgs(['abc', 'hello', '--local-id='])).toThrow(PingPeerError)
    })

    it('parses --list and --help', () => {
        expect(parsePingPeerArgs(['--list'])).toEqual({ help: false, list: true })
        expect(parsePingPeerArgs(['--help']).help).toBe(true)
    })

    it('rejects unknown flags', () => {
        expect(() => parsePingPeerArgs(['--host', 'evil'])).toThrow(PingPeerError)
    })
})
