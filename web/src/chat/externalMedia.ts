import type { ExternalMedia } from '@hapi/protocol/messengers'

export function shouldAutoLoadExternalMedia(media: ExternalMedia): boolean {
    return media.kind === 'image'
        || media.kind === 'sticker'
        || media.isAnimated === true
        || media.isRound === true
}
