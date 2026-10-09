import type { ExternalMedia } from '@hapi/protocol/messengers'

/**
 * How a sticker's downloaded original can be shown in the browser. Telegram
 * stickers arrive as static images (webp/png), looping video stickers (webm)
 * or gzipped Lottie animations (.tgs, `application/x-tgsticker`).
 */
export type StickerRenderKind = 'image' | 'video' | 'lottie'

export function stickerRenderKind(mimeType: string | null): StickerRenderKind | null {
    const mime = mimeType?.toLowerCase() ?? ''
    if (mime.startsWith('video/')) return 'video'
    if (mime === 'application/x-tgsticker') return 'lottie'
    if (mime === '' || mime.startsWith('image/')) return 'image'
    return null
}

export function shouldAutoLoadExternalMedia(media: ExternalMedia): boolean {
    if (media.kind === 'sticker') {
        // Only fetch sticker originals the browser can actually draw; unknown
        // mimes stay user-triggered and render as a download link.
        return stickerRenderKind(media.mimeType) !== null
    }
    // Voice notes and audio pre-buffer as they scroll into view so pressing
    // play starts instantly; the hub already keeps them warm in its cache.
    return media.kind === 'image'
        || media.kind === 'voice'
        || media.kind === 'audio'
        || media.isAnimated === true
        || media.isRound === true
}
