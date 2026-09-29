import { describe, expect, it } from 'bun:test'
import { buildMediaUrl } from './yandexConnector'
import type { AttachmentRef } from './shapes'

describe('buildMediaUrl', () => {
    it('uses /file_shortterm for regular attachments (image, file, voice, gallery_image)', () => {
        for (const kind of ['image', 'file', 'voice', 'gallery_image'] as const) {
            const ref: AttachmentRef = { kind, fileId: 'bucket/abc-123' }
            expect(buildMediaUrl(ref)).toBe('https://files.messenger.yandex.ru/file_shortterm/bucket/abc-123?attach=true')
        }
    })

    it('uses the sticker path on the same host (no /file_shortterm/, no ?attach=true)', () => {
        const ref: AttachmentRef = { kind: 'sticker', fileId: 'stickers/images/2509/28331.png' }
        expect(buildMediaUrl(ref)).toBe('https://files.messenger.yandex.ru/stickers/images/2509/28331.png')
    })
})
