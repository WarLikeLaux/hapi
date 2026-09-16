import { describe, expect, it } from 'vitest'
import type { ExternalMedia } from '@hapi/protocol/messengers'
import { shouldAutoLoadExternalMedia } from './externalMedia'

function media(overrides: Partial<ExternalMedia>): ExternalMedia {
    return {
        kind: 'file',
        mimeType: null,
        fileName: null,
        size: null,
        thumbnailDataUrl: null,
        ...overrides
    }
}

describe('shouldAutoLoadExternalMedia', () => {
    it('loads visual Telegram media even when no thumbnail was provided', () => {
        expect(shouldAutoLoadExternalMedia(media({ kind: 'image' }))).toBe(true)
        expect(shouldAutoLoadExternalMedia(media({ kind: 'sticker' }))).toBe(true)
        expect(shouldAutoLoadExternalMedia(media({ kind: 'video', isAnimated: true }))).toBe(true)
        expect(shouldAutoLoadExternalMedia(media({ kind: 'video', isRound: true }))).toBe(true)
    })

    it('leaves large ordinary files and videos user-triggered', () => {
        expect(shouldAutoLoadExternalMedia(media({ kind: 'file' }))).toBe(false)
        expect(shouldAutoLoadExternalMedia(media({ kind: 'video' }))).toBe(false)
    })
})
