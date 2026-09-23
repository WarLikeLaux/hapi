import { describe, expect, it } from 'vitest'
import {
    AGY_BUCKETS,
    agySourceId,
    agyWindowFromBucket,
    extractAgyWindows,
    isMainHomeAgyInstance,
    isoToUnixSeconds,
    parsePublishedAgyTargets
} from './agy'

describe('isMainHomeAgyInstance', () => {
    it('keeps instances on the real home and unknown-home instances', () => {
        expect(isMainHomeAgyInstance('/home/u', '/home/u')).toBe(true)
        expect(isMainHomeAgyInstance(null, '/home/u')).toBe(true)
    })

    it('rejects profiled secondary-account instances', () => {
        expect(isMainHomeAgyInstance('/home/u/.agy-profiles/second', '/home/u')).toBe(false)
    })
})

const NOW_SEC = 1_700_000_000

describe('parsePublishedAgyTargets', () => {
    it('parses ports with a csrf token', () => {
        expect(parsePublishedAgyTargets({ ports: [8080, 9090], csrf_token: 'tok' })).toEqual([
            { port: 8080, csrfToken: 'tok' },
            { port: 9090, csrfToken: 'tok' }
        ])
    })

    it('allows a missing csrf token and rejects invalid ports', () => {
        expect(parsePublishedAgyTargets({ ports: [70000, -1, 1.5, '8080', 1234] })).toEqual([{ port: 1234, csrfToken: null }])
    })

    it('returns empty for malformed payloads', () => {
        expect(parsePublishedAgyTargets(null)).toEqual([])
        expect(parsePublishedAgyTargets({})).toEqual([])
        expect(parsePublishedAgyTargets({ ports: '8080' })).toEqual([])
    })
})

describe('isoToUnixSeconds', () => {
    it('converts an ISO timestamp to unix seconds', () => {
        expect(isoToUnixSeconds('2023-11-14T22:13:20Z')).toBe(NOW_SEC)
    })

    it('returns null for non-strings and unparseable values', () => {
        expect(isoToUnixSeconds(123)).toBeNull()
        expect(isoToUnixSeconds('not-a-date')).toBeNull()
    })
})

describe('agyWindowFromBucket', () => {
    it('converts remainingFraction to spent percent', () => {
        expect(agyWindowFromBucket({ remainingFraction: 0.25, resetTime: '2023-11-14T22:13:20Z' }, 'agy:user:5h', NOW_SEC))
            .toEqual({ source: 'agy:user:5h', usedPercent: 75, resetsAt: NOW_SEC, measuredAt: NOW_SEC })
    })

    it('clamps remainingFraction into [0, 1]', () => {
        expect(agyWindowFromBucket({ remainingFraction: 1.7 }, 'agy:user:weekly', NOW_SEC)?.usedPercent).toBe(0)
        expect(agyWindowFromBucket({ remainingFraction: -0.5 }, 'agy:user:weekly', NOW_SEC)?.usedPercent).toBe(100)
    })

    it('returns null without remainingFraction', () => {
        expect(agyWindowFromBucket({ resetTime: 'x' }, 'agy:user:5h', NOW_SEC)).toBeNull()
        expect(agyWindowFromBucket(null, 'agy:user:5h', NOW_SEC)).toBeNull()
    })
})

describe('extractAgyWindows', () => {
    const response = {
        response: {
            groups: [
                { buckets: [{ bucketId: AGY_BUCKETS['5h'], remainingFraction: 0.5, resetTime: '2023-11-14T22:13:20Z' }] },
                { buckets: [{ bucketId: AGY_BUCKETS.weekly, remainingFraction: 1, resetTime: '2023-11-20T00:00:00Z' }] },
                { buckets: [{ bucketId: 'other-bucket', remainingFraction: 0 }] }
            ]
        }
    }

    it('extracts both tracked buckets and labels them via sourceId', () => {
        const windows = extractAgyWindows(response, (kind) => agySourceId('user', kind), NOW_SEC)
        expect(windows).toEqual([
            { source: 'agy:user:5h', usedPercent: 50, resetsAt: NOW_SEC, measuredAt: NOW_SEC },
            { source: 'agy:user:weekly', usedPercent: 0, resetsAt: isoToUnixSeconds('2023-11-20T00:00:00Z'), measuredAt: NOW_SEC }
        ])
    })

    it('returns empty for malformed responses', () => {
        expect(extractAgyWindows(null, (kind) => agySourceId('u', kind), NOW_SEC)).toEqual([])
        expect(extractAgyWindows({}, (kind) => agySourceId('u', kind), NOW_SEC)).toEqual([])
        expect(extractAgyWindows({ response: { groups: 'nope' } }, (kind) => agySourceId('u', kind), NOW_SEC)).toEqual([])
    })
})
