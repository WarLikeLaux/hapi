import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseCursorMonthlyUsage, cursorAuthPaths, CURSOR_MONTHLY_SOURCE } from './cursor'

const NOW_SEC = 1_700_000_000
const CYCLE_END_MS = 1_700_200_000_000

describe('cursorAuthPaths', () => {
    it('uses the platform config location', () => {
        // The switch reads the live platform, so only the current branch is asserted.
        const expected = process.platform === 'darwin'
            ? join('/h', '.cursor', 'auth.json')
            : process.platform === 'win32'
                ? join('/h', 'AppData', 'Roaming', 'Cursor', 'auth.json')
                : join('/h', '.config', 'cursor', 'auth.json')
        expect(cursorAuthPaths({}, '/h')).toEqual([expected])
    })
})

describe('parseCursorMonthlyUsage', () => {
    it('prefers cents math from limit and remaining', () => {
        expect(parseCursorMonthlyUsage({
            billingCycleEnd: String(CYCLE_END_MS),
            planUsage: { limit: 2000, remaining: 500 }
        }, NOW_SEC)).toEqual({
            source: CURSOR_MONTHLY_SOURCE,
            usedPercent: 75,
            resetsAt: CYCLE_END_MS / 1000,
            measuredAt: NOW_SEC
        })
    })

    it('falls back to the totalPercentUsed fraction', () => {
        const quotaWindow = parseCursorMonthlyUsage({ billingCycleEnd: '0', planUsage: { totalPercentUsed: 0.3 } }, NOW_SEC)
        expect(quotaWindow).toEqual({ source: CURSOR_MONTHLY_SOURCE, usedPercent: 30, resetsAt: null, measuredAt: NOW_SEC })
    })

    it('treats the unlimited sentinel as unusable cents data', () => {
        const quotaWindow = parseCursorMonthlyUsage({ planUsage: { limit: 2147483647, remaining: 1, totalPercentUsed: 0.1 } }, NOW_SEC)
        expect(quotaWindow?.usedPercent).toBe(10)
    })

    it('returns null on malformed payloads', () => {
        expect(parseCursorMonthlyUsage(null, NOW_SEC)).toBeNull()
        expect(parseCursorMonthlyUsage({}, NOW_SEC)).toBeNull()
        expect(parseCursorMonthlyUsage({ planUsage: {} }, NOW_SEC)).toBeNull()
        expect(parseCursorMonthlyUsage({ planUsage: { totalPercentUsed: 5 } }, NOW_SEC)).toBeNull()
    })
})
