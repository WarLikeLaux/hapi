import { Hono } from 'hono'
import { z } from 'zod'
import {
    KlipyCategorySchema,
    KlipyGifSchema,
    KlipySearchResponseSchema,
    type KlipyCategoriesResponse,
    type KlipyFileVariant,
    type KlipyGif,
    type KlipySearchResponse
} from '@hapi/protocol/klipy'
import { getConfiguration } from '../../configuration'
import type { WebAppEnv } from '../middleware/auth'

/**
 * KLIPY GIF API proxy.
 *
 * The browser never sees the partner API key — every call goes through the hub
 * so the secret stays server-side and we can enforce a single rate budget.
 *
 * The KLIPY partner API embeds the key in the URL path
 * (`https://api.klipy.com/api/v1/<KEY>/gifs/{search,trending,categories}`).
 * We mirror that here: the key never appears in the query string, never on the
 * wire to the browser, and never in our logs.
 *
 * Endpoints:
 * - GET /api/klipy/search?q=<term>&page=<n>&per_page=<m>
 * - GET /api/klipy/trending?page=<n>&per_page=<m>
 * - GET /api/klipy/categories
 */

const KLIPY_BASE_URL = 'https://api.klipy.com/api/v1'
// Hard cap regardless of what the caller asks for — keeps the UI responsive
// and bounds upstream bandwidth on a 100 rph test key.
const MAX_PER_PAGE = 24
const DEFAULT_PER_PAGE = 12
// 8s is plenty for a small JSON payload and well under the partner SLA.
const UPSTREAM_TIMEOUT_MS = 8_000

function jsonError(c: { json: (body: unknown, status: number) => Response }, status: number, message: string) {
    return c.json({ error: message }, status)
}

function clampPerPage(raw: string | undefined): number {
    const n = Number.parseInt(raw ?? '', 10)
    if (!Number.isFinite(n) || n <= 0) return DEFAULT_PER_PAGE
    return Math.min(n, MAX_PER_PAGE)
}

function clampPage(raw: string | undefined): number {
    const n = Number.parseInt(raw ?? '', 10)
    if (!Number.isFinite(n) || n <= 0) return 1
    return Math.min(n, 1000)
}

/**
 * Pick a usable variant out of the `file.<bucket>.<format>` tree KLIPY ships.
 * We try the smallest bucket first so the picker grid stays cheap; for sending
 * we prefer animated GIF/MP4 and skip jpg (Telegram would not animate it).
 */
function pickVariant(file: Record<string, unknown>, buckets: string[], formats: string[]): KlipyFileVariant | null {
    for (const bucket of buckets) {
        const bucketData = file[bucket]
        if (!bucketData || typeof bucketData !== 'object') continue
        for (const format of formats) {
            const entry = (bucketData as Record<string, unknown>)[format]
            if (!entry || typeof entry !== 'object') continue
            const url = (entry as Record<string, unknown>).url
            const width = (entry as Record<string, unknown>).width
            const height = (entry as Record<string, unknown>).height
            if (typeof url !== 'string' || url.length === 0) continue
            return {
                url,
                width: typeof width === 'number' ? width : 0,
                height: typeof height === 'number' ? height : 0
            }
        }
    }
    return null
}

function pickPreview(file: Record<string, unknown>): string | null {
    // Stills first (cheap to render in the picker grid), then animated gif/webp.
    return pickVariant(file, ['xs', 'sm', 'md', 'hd'], ['jpg', 'gif', 'webp'])?.url ?? null
}

function pickDownload(file: Record<string, unknown>): string | null {
    // Animated only — Telegram will display the mp4/gif/webm inline.
    // Prefer mp4 (smallest bytes), then gif, then webm.
    return pickVariant(file, ['sm', 'md', 'hd', 'xs'], ['mp4', 'gif', 'webm'])?.url ?? null
}

function normaliseGif(item: unknown): KlipyGif | null {
    if (!item || typeof item !== 'object') return null
    const record = item as Record<string, unknown>
    const idRaw = record.id
    const id = typeof idRaw === 'number'
        ? String(idRaw)
        : typeof idRaw === 'string' && idRaw.length > 0 ? idRaw : null
    if (!id) return null
    const file = record.file
    const preview = file && typeof file === 'object'
        ? pickPreview(file as Record<string, unknown>)
        : null
    const download = file && typeof file === 'object'
        ? pickDownload(file as Record<string, unknown>)
        : null
    const firstVariant = file && typeof file === 'object'
        ? pickVariant(file as Record<string, unknown>, ['sm', 'md', 'hd'], ['gif', 'webp', 'mp4'])
        : null
    return {
        id,
        slug: typeof record.slug === 'string' ? record.slug : null,
        title: typeof record.title === 'string' ? record.title : '',
        blurPreview: typeof record.blur_preview === 'string' ? record.blur_preview : null,
        previewUrl: preview,
        downloadUrl: download,
        width: firstVariant?.width ?? null,
        height: firstVariant?.height ?? null
    }
}

async function callKlipy(path: string, params: Record<string, string>): Promise<unknown> {
    const config = getConfiguration()
    if (!config.klipyApiKey) {
        throw new KlipyError(503, 'KLIPY is not configured on this hub (KLIPY_API_KEY missing)')
    }

    const url = new URL(`${KLIPY_BASE_URL}/${config.klipyApiKey}${path}`)
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS)
    try {
        const response = await fetch(url, { method: 'GET', signal: controller.signal })
        if (response.status === 401 || response.status === 403) {
            throw new KlipyError(502, 'KLIPY rejected the configured API key')
        }
        if (response.status === 429) {
            throw new KlipyError(503, 'KLIPY rate limit exceeded for this hub')
        }
        if (!response.ok) {
            throw new KlipyError(502, `KLIPY responded ${response.status}`)
        }
        const payload = await response.json().catch(() => null)
        if (!payload || typeof payload !== 'object') {
            throw new KlipyError(502, 'KLIPY returned an empty body')
        }
        const root = payload as Record<string, unknown>
        if (root.result === false) {
            const message = Array.isArray((root as { errors?: { message?: unknown[] } }).errors?.message)
                ? String((root as { errors?: { message?: unknown[] } }).errors!.message![0] ?? 'unknown error')
                : 'KLIPY returned an error envelope'
            throw new KlipyError(502, `KLIPY: ${message}`)
        }
        return payload
    } catch (error) {
        if (error instanceof KlipyError) throw error
        if (error instanceof DOMException && error.name === 'AbortError') {
            throw new KlipyError(504, 'KLIPY request timed out')
        }
        throw new KlipyError(502, 'KLIPY request failed')
    } finally {
        clearTimeout(timer)
    }
}

class KlipyError extends Error {
    public readonly status: number
    constructor(status: number, message: string) {
        super(message)
        this.status = status
    }
}

const RawEnvelopeSchema = z.object({
    result: z.boolean().optional(),
    data: z.object({
        data: z.array(z.unknown()),
        has_next: z.boolean().optional(),
        current_page: z.number().int().positive().optional()
    }).passthrough()
}).passthrough()

function parseSearch(payload: unknown): KlipySearchResponse {
    const parsed = RawEnvelopeSchema.safeParse(payload)
    if (!parsed.success) {
        throw new KlipyError(502, 'KLIPY returned an unrecognised payload')
    }
    const rawItems = parsed.data.data.data
    const gifs: KlipyGif[] = []
    const seen = new Set<string>()
    for (const raw of rawItems) {
        const gif = normaliseGif(raw)
        if (!gif || seen.has(gif.id)) continue
        seen.add(gif.id)
        // Re-validate through Zod so the API contract is enforced.
        const result = KlipyGifSchema.safeParse(gif)
        if (result.success) gifs.push(result.data)
    }
    return {
        gifs,
        next: parsed.data.data.has_next ? (parsed.data.data.current_page ?? 1) + 1 : null
    }
}

function parseCategories(payload: unknown): KlipyCategoriesResponse {
    const envelope = z.object({
        result: z.boolean().optional(),
        data: z.object({
            locale: z.string().nullable().optional(),
            categories: z.array(z.object({
                category: z.string(),
                query: z.string(),
                preview_url: z.string().url().nullable().optional()
            }).passthrough())
        }).passthrough()
    }).passthrough().safeParse(payload)
    if (!envelope.success) {
        throw new KlipyError(502, 'KLIPY returned an unrecognised categories payload')
    }
    const categories = envelope.data.data.categories.map((entry) => {
        const normalised = KlipyCategorySchema.parse({
            category: entry.category,
            query: entry.query,
            previewUrl: entry.preview_url ?? null
        })
        return normalised
    })
    return {
        categories,
        locale: envelope.data.data.locale ?? null
    }
}

export function createKlipyRoutes(): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    app.get('/klipy/search', async (c) => {
        const q = c.req.query('q')?.trim() ?? ''
        if (q.length === 0) return jsonError(c, 400, 'Query parameter `q` is required')
        if (q.length > 100) return jsonError(c, 400, 'Query parameter `q` is too long')
        try {
            const payload = await callKlipy('/gifs/search', {
                q,
                page: String(clampPage(c.req.query('page'))),
                per_page: String(clampPerPage(c.req.query('per_page')))
            })
            const response = parseSearch(payload)
            return c.json(KlipySearchResponseSchema.parse(response))
        } catch (error) {
            const status = error instanceof KlipyError ? error.status : 502
            return jsonError(c, status, errorMessage(error))
        }
    })

    app.get('/klipy/trending', async (c) => {
        try {
            const payload = await callKlipy('/gifs/trending', {
                page: String(clampPage(c.req.query('page'))),
                per_page: String(clampPerPage(c.req.query('per_page')))
            })
            const response = parseSearch(payload)
            return c.json(KlipySearchResponseSchema.parse(response))
        } catch (error) {
            const status = error instanceof KlipyError ? error.status : 502
            return jsonError(c, status, errorMessage(error))
        }
    })

    app.get('/klipy/categories', async (c) => {
        try {
            const payload = await callKlipy('/gifs/categories', {})
            const response = parseCategories(payload)
            return c.json(response)
        } catch (error) {
            const status = error instanceof KlipyError ? error.status : 502
            return jsonError(c, status, errorMessage(error))
        }
    })

    return app
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'KLIPY request failed'
}