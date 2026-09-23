import { describe, expect, it } from 'vitest'
import { parseCodexWindows, codexErrorReason, CODEX_FIVE_HOUR_SOURCE, CODEX_WEEKLY_SOURCE } from './codex'

const NOW_SEC = 1_700_000_000

const FIVE_HOUR = { windowDurationMins: 300, usedPercent: 12.4, resetsAt: NOW_SEC + 3600 }
const WEEKLY = { windowDurationMins: 10_080, usedPercent: 55, resetsAt: NOW_SEC + 86_400 }

describe('parseCodexWindows', () => {
    it('maps both slots by window duration', () => {
        expect(parseCodexWindows({ primary: WEEKLY, secondary: FIVE_HOUR }, NOW_SEC)).toEqual([
            { source: CODEX_WEEKLY_SOURCE, usedPercent: 55, resetsAt: NOW_SEC + 86_400, measuredAt: NOW_SEC },
            { source: CODEX_FIVE_HOUR_SOURCE, usedPercent: 12.4, resetsAt: NOW_SEC + 3600, measuredAt: NOW_SEC }
        ])
    })

    it('matches windows regardless of which slot holds the weekly window', () => {
        const windows = parseCodexWindows({ primary: FIVE_HOUR, secondary: WEEKLY }, NOW_SEC)
        expect(windows.map((quotaWindow) => quotaWindow.source).sort()).toEqual([CODEX_FIVE_HOUR_SOURCE, CODEX_WEEKLY_SOURCE])
    })

    it('ignores unknown window durations and malformed slots', () => {
        expect(parseCodexWindows({ primary: { windowDurationMins: 60, usedPercent: 1 } }, NOW_SEC)).toEqual([])
        expect(parseCodexWindows({ primary: null, secondary: 'x' }, NOW_SEC)).toEqual([])
        expect(parseCodexWindows({ primary: { windowDurationMins: 300 } }, NOW_SEC)).toEqual([])
        expect(parseCodexWindows('nope', NOW_SEC)).toEqual([])
    })

    it('tolerates a missing resetsAt and clamps percentages', () => {
        expect(parseCodexWindows({ primary: { windowDurationMins: 300, usedPercent: 140 } }, NOW_SEC))
            .toEqual([{ source: CODEX_FIVE_HOUR_SOURCE, usedPercent: 100, resetsAt: null, measuredAt: NOW_SEC }])
    })
})

describe('codexErrorReason', () => {
    it('maps expired-token and 401 errors to auth_expired', () => {
        expect(codexErrorReason('stream error: token_expired')).toBe('auth_expired')
        expect(codexErrorReason('HTTP 401 Unauthorized')).toBe('auth_expired')
    })

    it('maps everything else to unavailable', () => {
        expect(codexErrorReason('connection refused')).toBe('unavailable')
        expect(codexErrorReason('')).toBe('unavailable')
    })
})
