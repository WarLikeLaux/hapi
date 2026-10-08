import { YANDEX_STICKER_PACK_ID, YandexStickerPackSchema, type YandexStickerPack } from '@hapi/protocol'
import { z } from 'zod'

const ResponseSchema = z.object({
    status: z.literal('ok'),
    data: z.array(YandexStickerPackSchema).length(1)
})
let cached: { pack: YandexStickerPack; expiresAt: number } | undefined
let pending: Promise<YandexStickerPack> | undefined

export async function getYandexStickerPack(): Promise<YandexStickerPack> {
    if (cached && cached.expiresAt > Date.now()) return cached.pack
    if (pending) return pending
    pending = (async () => {
        const response = await fetch(`https://files.messenger.yandex.net/stickers/packs?id=${YANDEX_STICKER_PACK_ID}`, {
            signal: AbortSignal.timeout(10_000)
        })
        if (!response.ok) throw new Error(`Sticker pack request failed with HTTP ${response.status}`)
        const parsed = ResponseSchema.safeParse(await response.json())
        if (!parsed.success) throw new Error('Yandex returned an invalid sticker pack')
        const pack = parsed.data.data[0]!
        cached = { pack, expiresAt: Date.now() + 5 * 60_000 }
        return pack
    })()
    try {
        return await pending
    } finally {
        pending = undefined
    }
}
