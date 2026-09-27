import { Hono } from 'hono'
import { getConfiguration } from '../../configuration'
import type { KlipyGif, KlipySearchResponse } from '@hapi/protocol/klipy'
import type { WebAppEnv } from '../middleware/auth'

/**
 * KLIPY GIF API proxy.
 *
 * The browser never sees the partner API key — every call goes through the hub
 * so the secret stays server-side and we can enforce a single rate budget.
 *
 * Response shape follows the KLIPY search API (`api.klipy.com/v1/{gifs|clips|stickers}/{action}`).
 * We currently only proxy GIF search/trending because the chat composer sends
 * GIFs as image attachments and does not need video clips or stickers yet.
 *
 * Endpoints:
 * - GET /api/klipy/search?q=<term>&limit=<n>&pos=<cursor>
 * - GET /api/klipy/trending?limit=<n>&pos=<cursor>
 */

const KLIPY_BASE_URL = 'https://api.klipy.com/api/v1'
// Hard cap regardless of what the caller asks for — keeps the UI responsive
// and bounds upstream bandwidth on a 100 rph test key.
const MAX_LIMIT = 24
const DEFAULT_LIMIT = 12
// 8s is plenty for a small JSON payload and well under the partner SLA.
const UPSTREAM_TIMEOUT_MS = 8_000

function jsonError(c: { json: (body: unknown, status: number) => Response }, status: number, message: string) {
    return c.json({ error: message }, status)
}

function clampLimit(raw: string | undefined): number {
    const n = Number.parseInt(raw ?? '', 10)
    if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT
    return Math.min(n, MAX_LIMIT)
}

function pickGifList(payload: unknown): KlipyGif[] {
    if (!payload || typeof payload !== 'object') return []
    const root = payload as Record<string, unknown>
    // KLIPY wraps results under `data` and `results` keys; older migrations use
    // a flat array. Be defensive — partner schema changes have happened before.
    const candidates: unknown[] = []
    const data = root.data
    if (Array.isArray(data)) candidates.push(...data)
    if (data && typeof data === 'object') {
        const inner = (data as Record<string, unknown>).results
        if (Array.isArray(inner)) candidates.push(...inner)
    }
    if (Array.isArray(root.results)) candidates.push(...root.results)

    const seen = new Set<string>()
    const gifs: KlipyGif[] = []
    for (const entry of candidates) {
        if (!entry || typeof entry !== 'object') continue
        const record = entry as Record<string, unknown>
        const id = typeof record.id === 'string' || typeof record.id === 'number'
            ? String(record.id)
            : null
        if (!id || seen.has(id)) continue
        seen.add(id)

        const titleRaw = record.title
        const slugRaw = record.slug
        const imagesRaw = record.images
        gifs.push({
            id,
            title: typeof titleRaw === 'string' ? titleRaw : '',
            slug: typeof slugRaw === 'string' ? slugRaw : null,
            url: typeof record.url === 'string' ? record.url : null,
            // Prefer a fixed-size preview that fits the chat picker grid; stills
            // first (cheaper to render) then animated versions, finally `url`.
            previewUrl: extractImageUrl(imagesRaw, [
                'fixed_width_small_still',
                'fixed_width_still',
                'fixed_width_small',
                'fixed_width',
                'preview_webp',
                'original_still',
                'original'
            ]) ?? (typeof record.url === 'string' ? record.url : null),
            // Send the smallest sensible MP4/GIF for actual transmission. KLIPY
            // returns `mp4` previews which Telegram accepts as image/gif media;
            // animated versions only — stills are useless for sending.
            downloadUrl: extractImageUrl(imagesRaw, [
                'fixed_width_small',
                'fixed_width',
                'preview_gif',
                'preview_webp',
                'original'
            ]),
            width: extractNumber(imagesRaw, ['fixed_width', 'original']),
            height: extractNumber(imagesRaw, ['fixed_width', 'original'])
        })
    }
    return gifs
}

function extractImageUrl(images: unknown, prefer: string[]): string | null {
    if (!images || typeof images !== 'object') return null
    for (const key of prefer) {
        const entry = (images as Record<string, unknown>)[key]
        if (entry && typeof entry === 'object') {
            const url = (entry as Record<string, unknown>).url
            if (typeof url === 'string' && url.length > 0) return url
        }
    }
    return null
}

function extractNumber(images: unknown, prefer: string[]): number | null {
    if (!images || typeof images !== 'object') return null
    for (const key of prefer) {
        const entry = (images as Record<string, unknown>)[key]
        if (entry && typeof entry === 'object') {
            const value = (entry as Record<string, unknown>).width
            if (typeof value === 'number' && Number.isFinite(value)) return value
        }
    }
    return null
}

async function callKlipy(path: string, params: Record<string, string>): Promise<{ gifs: KlipyGif[]; next: string | null }> {
    const config = getConfiguration()
    if (!config.klipyApiKey) {
        throw new KlipyError(503, 'KLIPY is not configured on this hub (KLIPY_API_KEY missing)')
    }

    const url = new URL(`${KLIPY_BASE_URL}${path}`)
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
    url.searchParams.set('api_key', config.klipyApiKey)

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
        const gifs = pickGifList(payload)
        const nextCursor = extractNextCursor(payload)
        return { gifs, next: nextCursor }
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

function extractNextCursor(payload: unknown): string | null {
    if (!payload || typeof payload !== 'object') return null
    const root = payload as Record<string, unknown>
    const meta = root.meta
    if (meta && typeof meta === 'object') {
        const next = (meta as Record<string, unknown>).next
        if (typeof next === 'string' && next.length > 0) return next
    }
    if (typeof root.next === 'string' && root.next.length > 0) return root.next
    return null
}

class KlipyError extends Error {
    public readonly status: number
    constructor(status: number, message: string) {
        super(message)
        this.status = status
    }
}

export function createKlipyRoutes(): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    app.get('/klipy/search', async (c) => {
        const q = c.req.query('q')?.trim() ?? ''
        if (q.length === 0) return jsonError(c, 400, 'Query parameter `q` is required')
        if (q.length > 100) return jsonError(c, 400, 'Query parameter `q` is too long')
        try {
            const { gifs, next } = await callKlipy('/gifs/search', {
                q,
                limit: String(clampLimit(c.req.query('limit'))),
                ...(c.req.query('pos') ? { pos: c.req.query('pos')! } : {})
            })
            const response: KlipySearchResponse = { gifs, next }
            return c.json(response)
        } catch (error) {
            const status = error instanceof KlipyError ? error.status : 502
            return jsonError(c, status, errorMessage(error))
        }
    })

    app.get('/klipy/trending', async (c) => {
        try {
            const { gifs, next } = await callKlipy('/gifs/trending', {
                limit: String(clampLimit(c.req.query('limit'))),
                ...(c.req.query('pos') ? { pos: c.req.query('pos')! } : {})
            })
            const response: KlipySearchResponse = { gifs, next }
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