import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { formatReset } from './limits'

type TFunc = (key: string, params?: Record<string, string | number>) => string

// Minimal stub of the en-US strings formatReset actually touches. Anything
// outside this dictionary is returned as the bare key, which is enough to
// catch regressions in the lookup itself.
const STRINGS: Record<string, string> = {
    'settings.limits.resets': 'Resets {relative} ({absolute})',
    'settings.limits.resetsTime': 'Resets {relative} ({time})',
    'settings.limits.resetsSoon': 'Resets soon',
    'settings.limits.resetsUnknown': 'Reset time unknown',
    'settings.limits.inUnderMinute': 'in <1 min',
    'settings.limits.inMinutes': 'in {minutes} min',
    'settings.limits.inHours': 'in {hours}h',
    'settings.limits.inHoursMinutes': 'in {hours}h {minutes}m',
    'settings.limits.inDay': 'in 1 day',
    'settings.limits.inDays': 'in {days} days',
    'settings.limits.inDaysHours': 'in {days}d {hours}h',
}

const t: TFunc = (key, params) => {
    const template = STRINGS[key] ?? key
    if (!params) return template
    let s = template
    for (const [k, v] of Object.entries(params)) {
        s = s.replaceAll(`{${k}}`, String(v))
    }
    return s
}

const NOW_MS = new Date('2026-09-27T17:00:00Z').getTime()

afterEach(() => {
    vi.useRealTimers()
})

describe('formatReset', () => {
    beforeEach(() => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date(NOW_MS))
    })

    it('returns the unknown marker when there is no reset time', () => {
        expect(formatReset(null, t)).toBe('Reset time unknown')
    })

    it('returns the soon marker for past reset times', () => {
        expect(formatReset(Math.floor((NOW_MS - 1000) / 1000), t)).toBe('Resets soon')
    })

    it('keeps the wall-clock time but drops the date when remaining time is under five hours', () => {
        // 3h 26m away — same row from the screenshot should drop "Sep 27," and
        // keep the 24-hour time: "Resets in 3h 26m (20:34)".
        const resetSec = Math.floor((NOW_MS + (3 * 3600 + 26 * 60) * 1000) / 1000)
        const out = formatReset(resetSec, t)
        const expected = new Date(resetSec * 1000).toLocaleString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        })
        expect(out).toBe(`Resets in 3h 26m (${expected})`)
        expect(out).not.toMatch(/[A-Z][a-z]{2} \d{1,2}/)
    })

    it('still drops the date when the reset lands on tomorrow and remaining is under five hours', () => {
        // 4h 51m away crosses midnight; the original row showed "Sep 27, 22:43".
        // We must keep only the wall-clock time even though the calendar date flips.
        const resetSec = Math.floor((NOW_MS + (4 * 3600 + 51 * 60) * 1000) / 1000)
        const out = formatReset(resetSec, t)
        const expected = new Date(resetSec * 1000).toLocaleString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        })
        expect(out).toBe(`Resets in 4h 51m (${expected})`)
        expect(out).not.toMatch(/[A-Z][a-z]{2} \d{1,2}/)
    })

    it('keeps the absolute date when remaining time is five hours or more', () => {
        // 6 days out — long weekday form must remain.
        const resetSec = Math.floor((NOW_MS + 6 * 24 * 3600 * 1000) / 1000)
        const out = formatReset(resetSec, t)
        expect(out).toMatch(/^Resets in 6 days \(/)
        expect(out).toContain(')')
    })

    it('keeps the monthly period end date even in the last hour of the period', () => {
        const resetSec = Math.floor((NOW_MS + 3600_000) / 1000)
        expect(formatReset(resetSec, t, true)).toMatch(/^Resets in 1h \([A-Z][a-z]{2} \d{1,2}, \d{2}:\d{2}\)$/)
    })

    it('drops the weekday name once remaining time is below one day', () => {
        // 12h away — date form, no weekday prefix.
        const resetSec = Math.floor((NOW_MS + 12 * 3600 * 1000) / 1000)
        const out = formatReset(resetSec, t)
        expect(out).toMatch(/^Resets in 12h \([A-Z][a-z]{2} \d{1,2}, \d{2}:\d{2}\)$/)
    })
})
