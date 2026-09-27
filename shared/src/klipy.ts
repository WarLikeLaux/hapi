import { z } from 'zod'

/**
 * KLIPY GIF metadata exposed to the web client. The hub normalises the upstream
 * KLIPY payload into this shape so the UI never depends on partner schema
 * quirks and never has to know about every image size KLIPY ships.
 */
export const KlipyGifSchema = z.object({
    id: z.string().min(1),
    title: z.string(),
    slug: z.string().nullable(),
    url: z.string().nullable(),
    previewUrl: z.string().nullable(),
    downloadUrl: z.string().nullable(),
    width: z.number().int().positive().nullable(),
    height: z.number().int().positive().nullable()
})
export type KlipyGif = z.infer<typeof KlipyGifSchema>

/**
 * Standard paginated response for `/api/klipy/search` and `/api/klipy/trending`.
 * `next` is an opaque cursor — pass it back as `pos` to fetch the following page.
 */
export const KlipySearchResponseSchema = z.object({
    gifs: z.array(KlipyGifSchema),
    next: z.string().nullable()
})
export type KlipySearchResponse = z.infer<typeof KlipySearchResponseSchema>

/**
 * Parameters accepted by `/api/klipy/search` and `/api/klipy/trending`. Mirrors
 * the querystring shape so the same schema can validate both the browser query
 * and any future internal callers.
 */
export const KlipySearchQuerySchema = z.object({
    q: z.string().trim().min(1).max(100),
    limit: z.coerce.number().int().positive().max(48).optional(),
    pos: z.string().min(1).max(256).optional()
})
export type KlipySearchQuery = z.infer<typeof KlipySearchQuerySchema>