import { describe, expect, it } from 'vitest'
import type { ExternalMedia } from '@hapi/protocol/messengers'
import { shouldAutoLoadExternalMedia, stickerRenderKind } from './externalMedia'

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

describe('stickerRenderKind', () => {
    it('maps the three Telegram sticker flavors', () => {
        expect(stickerRenderKind('image/webp')).toBe('image')
        expect(stickerRenderKind('video/webm')).toBe('video')
        expect(stickerRenderKind('application/x-tgsticker')).toBe('lottie')
    })

    it('keeps legacy unknown mimes on the image path and rejects others', () => {
        expect(stickerRenderKind(null)).toBe('image')
        expect(stickerRenderKind('')).toBe('image')
        expect(stickerRenderKind('application/octet-stream')).toBe(null)
    })
})

describe('shouldAutoLoadExternalMedia', () => {
    it('loads visual Telegram media even when no thumbnail was provided', () => {
        expect(shouldAutoLoadExternalMedia(media({ kind: 'image' }))).toBe(true)
        expect(shouldAutoLoadExternalMedia(media({ kind: 'sticker', mimeType: 'image/webp' }))).toBe(true)
        expect(shouldAutoLoadExternalMedia(media({ kind: 'sticker', mimeType: 'video/webm' }))).toBe(true)
        expect(shouldAutoLoadExternalMedia(media({ kind: 'sticker', mimeType: 'application/x-tgsticker' }))).toBe(true)
        expect(shouldAutoLoadExternalMedia(media({ kind: 'video', isAnimated: true }))).toBe(true)
        expect(shouldAutoLoadExternalMedia(media({ kind: 'video', isRound: true }))).toBe(true)
    })

    it('pre-buffers voice notes and audio so play starts instantly', () => {
        expect(shouldAutoLoadExternalMedia(media({ kind: 'voice' }))).toBe(true)
        expect(shouldAutoLoadExternalMedia(media({ kind: 'audio' }))).toBe(true)
    })

    it('leaves large ordinary files and videos user-triggered', () => {
        expect(shouldAutoLoadExternalMedia(media({ kind: 'file' }))).toBe(false)
        expect(shouldAutoLoadExternalMedia(media({ kind: 'video' }))).toBe(false)
    })

    it('does not auto-download stickers the browser cannot render', () => {
        expect(shouldAutoLoadExternalMedia(media({ kind: 'sticker', mimeType: 'application/octet-stream' }))).toBe(false)
    })
})
