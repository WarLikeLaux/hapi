import { describe, expect, it } from 'vitest'
import {
    AGY_BUCKETS,
    agySourceId,
    agyWindowFromBucket,
    extractAgyWindows,
    isMainHomeAgyInstance,
    isoToUnixSeconds,
    mergeAgyWindows,
    parsePublishedAgyTargets
} from './agy'
import type { QuotaWindow } from '@hapi/protocol/quotas'

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

describe('mergeAgyWindows', () => {
    const FRESH_5H: QuotaWindow = { source: 'agy:user:5h', usedPercent: 18, resetsAt: NOW_SEC + 3600, measuredAt: NOW_SEC }
    const STALE_5H: QuotaWindow = { source: 'agy:user:5h', usedPercent: 1.4, resetsAt: NOW_SEC + 7200, measuredAt: NOW_SEC - 3600 }
    const STALE_WEEKLY: QuotaWindow = { source: 'agy:user:weekly', usedPercent: 57, resetsAt: NOW_SEC + 86400, measuredAt: NOW_SEC - 3600 }

    it('prefers fresh measurements over previous snapshot for live accounts', () => {
        const result = mergeAgyWindows([FRESH_5H], [STALE_5H], new Set(['user']))
        expect(result).toEqual([FRESH_5H])
    })

    it('falls back to previous window if fresh was not fetched for a live account', () => {
        const result = mergeAgyWindows([FRESH_5H], [STALE_5H, STALE_WEEKLY], new Set(['user']))
        expect(result).toEqual([FRESH_5H, STALE_WEEKLY])
    })

    it('drops stopped secondary accounts when other accounts are live', () => {
        const secondaryStale: QuotaWindow = { source: 'agy:other:5h', usedPercent: 10, resetsAt: NOW_SEC, measuredAt: NOW_SEC - 3600 }
        const result = mergeAgyWindows([FRESH_5H], [STALE_5H, secondaryStale], new Set(['user']))
        expect(result).toEqual([FRESH_5H])
    })

    it('preserves entire previous snapshot when nothing is live', () => {
        const result = mergeAgyWindows([], [STALE_5H, STALE_WEEKLY], new Set())
        expect(result).toEqual([STALE_5H, STALE_WEEKLY])
    })
})
