import { describe, expect, it } from 'vitest'
import { formatRoundVideoTime } from './RoundVideoPlayer'

describe('formatRoundVideoTime', () => {
    it('formats video-message time without decimals', () => {
        expect(formatRoundVideoTime(0)).toBe('0:00')
        expect(formatRoundVideoTime(7.9)).toBe('0:07')
        expect(formatRoundVideoTime(67)).toBe('1:07')
    })

    it('guards invalid media durations', () => {
        expect(formatRoundVideoTime(Number.NaN)).toBe('0:00')
        expect(formatRoundVideoTime(Number.POSITIVE_INFINITY)).toBe('0:00')
    })
})
