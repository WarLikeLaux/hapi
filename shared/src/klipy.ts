import { z } from 'zod'

/**
 * KLIPY GIF file — one format variant at a specific resolution.
 * The partner ships `hd`, `md`, `sm`, `xs` buckets and `gif`, `webp`,
 * `jpg`, `mp4`, `webm` formats within each. We pick the best variant
 * for each UI surface (preview vs. download).
 */
export const KlipyFileVariantSchema = z.object({
    url: z.string().url(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    size: z.number().int().nonnegative().optional()
})
export type KlipyFileVariant = z.infer<typeof KlipyFileVariantSchema>

/**
 * One GIF record as returned by `/api/v1/<KEY>/gifs/{search,trending}`.
 *
 * The actual `id` is a numeric string in JSON; we coerce to string for
 * stable React keys. `slug` is the shareable identifier (use it for
 * view/share endpoints, not `id`).
 */
export const KlipyGifSchema = z.object({
    id: z.string().min(1),
    slug: z.string().nullable(),
    title: z.string(),
    /**
     * Cheap inline preview (data URL). Browsers render this instantly without
     * an extra HTTP round-trip while the full preview is still loading.
     */
    blurPreview: z.string().nullable(),
    /**
     * URL of a small animated GIF, used in the picker grid (fast to decode).
     * Falls back to the lowest-resolution webp when the GIF variant is missing.
     */
    previewUrl: z.string().url().nullable(),
    /**
     * URL of a reasonable-quality animated GIF/MP4 for sending. The chat
     * composer treats the result as an image attachment and lets Telegram
     * decide how to display it.
     */
    downloadUrl: z.string().url().nullable(),
    width: z.number().int().positive().nullable(),
    height: z.number().int().positive().nullable()
})
export type KlipyGif = z.infer<typeof KlipyGifSchema>

/**
 * Pagination + result envelope for `/api/v1/<KEY>/gifs/{search,trending}`.
 *
 * `next` is the integer page to fetch, or `null` when `has_next` is false.
 * Pass it back as `page` (not `pos` — KLIPY uses page-based paging).
 */
export const KlipySearchResponseSchema = z.object({
    gifs: z.array(KlipyGifSchema),
    next: z.number().int().positive().nullable()
})
export type KlipySearchResponse = z.infer<typeof KlipySearchResponseSchema>

/**
 * Parameters accepted by `/api/klipy/search` and `/api/klipy/trending`.
 * Mirrors the KLIPY partner API: `page` for pagination, `per_page` for
 * batch size. `q` is required for search, ignored by trending.
 */
export const KlipySearchQuerySchema = z.object({
    q: z.string().trim().min(1).max(100).optional(),
    page: z.coerce.number().int().positive().max(1000).optional(),
    per_page: z.coerce.number().int().positive().max(48).optional()
})
export type KlipySearchQuery = z.infer<typeof KlipySearchQuerySchema>

/**
 * `/api/klipy/categories` payload — used to populate a category chip row
 * inside the picker. Each entry exposes `query` so the web can chain it
 * back into a search call without a free-text input.
 */
export const KlipyCategorySchema = z.object({
    category: z.string(),
    query: z.string(),
    previewUrl: z.string().url().nullable()
})
export type KlipyCategory = z.infer<typeof KlipyCategorySchema>

export const KlipyCategoriesResponseSchema = z.object({
    categories: z.array(KlipyCategorySchema),
    locale: z.string().nullable()
})
export type KlipyCategoriesResponse = z.infer<typeof KlipyCategoriesResponseSchema>