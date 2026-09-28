import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { Hono } from 'hono'
import { createKlipyRoutes } from './klipy'
import type { WebAppEnv } from '../middleware/auth'

/**
 * Tests for the KLIPY GIF proxy. The hub holds the partner key server-side —
 * we exercise the route with a stubbed `getConfiguration` so the tests stay
 * hermetic and never touch the network.
 *
 * The real KLIPY partner URL is `https://api.klipy.com/api/v1/<KEY>/...` —
 * every assertion that touches fetch verifies the key is appended to the path
 * (never the query string) and the proxy normalises the response envelope.
 */

const originalFetch = globalThis.fetch

function app() {
    const h = new Hono<WebAppEnv>()
    h.use('*', async (c, next) => {
        c.set('namespace', 'default')
        await next()
    })
    h.route('/', createKlipyRoutes())
    return h
}

function trendingPayload(gifs: Array<{ id: number | string; title?: string; slug?: string }>) {
    return {
        result: true,
        data: {
            data: gifs.map((gif) => ({
                id: gif.id,
                slug: gif.slug ?? String(gif.id),
                title: gif.title ?? 'GIF',
                tags: [],
                type: 'gif',
                blur_preview: null,
                file: {
                    xs: {
                        jpg: { url: `https://static.klipy.com/ii/xs/${gif.id}.jpg`, width: 100, height: 100 },
                        gif: { url: `https://static.klipy.com/ii/xs/${gif.id}.gif`, width: 100, height: 100 }
                    },
                    sm: {
                        mp4: { url: `https://static.klipy.com/ii/sm/${gif.id}.mp4`, width: 220, height: 220 },
                        gif: { url: `https://static.klipy.com/ii/sm/${gif.id}.gif`, width: 220, height: 220 }
                    },
                    md: { gif: { url: `https://static.klipy.com/ii/md/${gif.id}.gif`, width: 480, height: 480 } },
                    hd: { gif: { url: `https://static.klipy.com/ii/hd/${gif.id}.gif`, width: 720, height: 720 } }
                }
            })),
            current_page: 1,
            per_page: 22,
            has_next: true,
            meta: { item_min_width: 80 }
        }
    }
}

function categoriesPayload() {
    return {
        result: true,
        data: {
            locale: 'en_US',
            categories: [
                { category: 'hello', query: 'hello', preview_url: 'https://static.klipy.com/ii/hello.gif' },
                { category: 'lol', query: 'lol', preview_url: 'https://static.klipy.com/ii/lol.gif' }
            ]
        }
    }
}

describe('klipy proxy routes', () => {
    let configSpy: ReturnType<typeof spyOn>

    beforeEach(async () => {
        const cfgModule = await import('../../configuration')
        configSpy = spyOn(cfgModule, 'getConfiguration').mockReturnValue({ klipyApiKey: 'test-key' } as never)
    })

    afterEach(() => {
        globalThis.fetch = originalFetch
        configSpy.mockRestore()
        mock.restore()
    })

    it('returns 503 when the hub has no KLIPY_API_KEY', async () => {
        configSpy.mockReturnValue({ klipyApiKey: null } as never)
        const response = await app().request('/klipy/search?q=cat')
        expect(response.status).toBe(503)
        const body = await response.json() as { error: string }
        expect(body.error).toMatch(/KLIPY_API_KEY/)
    })

    it('embeds the key in the URL path and queries `q`', async () => {
        let observedUrl: string = ''
        const fetchMock = mock(async (input: Request | string | URL) => {
            const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
            observedUrl = url
            return new Response(JSON.stringify(trendingPayload([{ id: 1, title: 'Cat' }])), {
                status: 200,
                headers: { 'content-type': 'application/json' }
            })
        })
        globalThis.fetch = fetchMock as unknown as typeof fetch

        const response = await app().request('/klipy/search?q=cat')
        expect(response.status).toBe(200)
        // Key must be in the path, never the query string.
        expect(observedUrl).toContain('https://api.klipy.com/api/v1/test-key/gifs/search')
        expect(observedUrl).not.toContain('api_key=')
        expect(observedUrl).toContain('q=cat')
    })

    it('caps `per_page` to keep the test key within budget', async () => {
        let observedUrl: string = ''
        const fetchMock = mock(async (input: Request | string | URL) => {
            const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
            observedUrl = url
            return new Response(JSON.stringify(trendingPayload([])), {
                status: 200,
                headers: { 'content-type': 'application/json' }
            })
        })
        globalThis.fetch = fetchMock as unknown as typeof fetch

        const response = await app().request('/klipy/search?q=dog&per_page=999')
        expect(response.status).toBe(200)
        expect(observedUrl).toContain('per_page=24')
    })

    it('rejects empty `q` with 400', async () => {
        const response = await app().request('/klipy/search?q=')
        expect(response.status).toBe(400)
    })

    it('returns 502 with a clean message when the upstream returns 401', async () => {
        const fetchMock = mock(async () => new Response('unauthorized', { status: 401 }))
        globalThis.fetch = fetchMock as unknown as typeof fetch

        const response = await app().request('/klipy/search?q=cat')
        expect(response.status).toBe(502)
        const body = await response.json() as { error: string }
        expect(body.error).toMatch(/rejected/)
    })

    it('returns 503 when the partner says rate-limited', async () => {
        const fetchMock = mock(async () => new Response('slow down', { status: 429 }))
        globalThis.fetch = fetchMock as unknown as typeof fetch

        const response = await app().request('/klipy/trending')
        expect(response.status).toBe(503)
        const body = await response.json() as { error: string }
        expect(body.error).toMatch(/rate limit/i)
    })

    it('surfaces KLIPY error envelopes as 502', async () => {
        const fetchMock = mock(async () => new Response(JSON.stringify({
            result: false,
            errors: { message: ['quota exhausted'] }
        }), { status: 200, headers: { 'content-type': 'application/json' } }))
        globalThis.fetch = fetchMock as unknown as typeof fetch

        const response = await app().request('/klipy/trending')
        expect(response.status).toBe(502)
        const body = await response.json() as { error: string }
        expect(body.error).toMatch(/quota exhausted/)
    })

    it('returns the trending endpoint without requiring `q`', async () => {
        let observedPath: string = ''
        const fetchMock = mock(async (input: Request | string | URL) => {
            const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
            observedPath = new URL(url).pathname
            return new Response(JSON.stringify(trendingPayload([{ id: 't1' }])), {
                status: 200,
                headers: { 'content-type': 'application/json' }
            })
        })
        globalThis.fetch = fetchMock as unknown as typeof fetch

        const response = await app().request('/klipy/trending')
        expect(response.status).toBe(200)
        expect(observedPath).toBe('/api/v1/test-key/gifs/trending')
    })

    it('normalises the upstream payload and computes `next` page', async () => {
        const fetchMock = mock(async () => new Response(JSON.stringify(trendingPayload([
            { id: 4978743036025682, title: 'Siddharth Ji', slug: 'siddharth-ji' }
        ])), { status: 200, headers: { 'content-type': 'application/json' } }))
        globalThis.fetch = fetchMock as unknown as typeof fetch

        const response = await app().request('/klipy/search?q=hi')
        expect(response.status).toBe(200)
        const body = await response.json() as { gifs: Array<{ id: string; title: string; previewUrl: string | null; downloadUrl: string | null; width: number | null }>; next: number | null }
        expect(body.gifs).toHaveLength(1)
        expect(body.gifs[0].id).toBe('4978743036025682')
        expect(body.gifs[0].title).toBe('Siddharth Ji')
        // previewUrl prefers an md source (sharp inside the grid tiles),
        // downloadUrl a real GIF (the user-visible contract for sending).
        expect(body.gifs[0].previewUrl).toContain('/md/')
        expect(body.gifs[0].downloadUrl).toContain('/md/')
        expect(body.gifs[0].downloadUrl).toMatch(/\.gif$/)
        // Pagination: has_next=true means next = current_page(1) + 1 = 2.
        expect(body.next).toBe(2)
    })

    it('returns null `next` when there are no more pages', async () => {
        const payload = trendingPayload([{ id: 'only' }])
        payload.data.has_next = false
        const fetchMock = mock(async () => new Response(JSON.stringify(payload), {
            status: 200, headers: { 'content-type': 'application/json' }
        }))
        globalThis.fetch = fetchMock as unknown as typeof fetch

        const response = await app().request('/klipy/trending')
        const body = await response.json() as { next: number | null }
        expect(body.next).toBeNull()
    })

    it('returns 502 when the upstream body is not JSON', async () => {
        const fetchMock = mock(async () => new Response('not json', {
            status: 200, headers: { 'content-type': 'text/plain' }
        }))
        globalThis.fetch = fetchMock as unknown as typeof fetch

        const response = await app().request('/klipy/trending')
        expect(response.status).toBe(502)
    })

    it('returns categories with the key in the path', async () => {
        let observedPath: string = ''
        const fetchMock = mock(async (input: Request | string | URL) => {
            const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
            observedPath = new URL(url).pathname
            return new Response(JSON.stringify(categoriesPayload()), {
                status: 200, headers: { 'content-type': 'application/json' }
            })
        })
        globalThis.fetch = fetchMock as unknown as typeof fetch

        const response = await app().request('/klipy/categories')
        expect(response.status).toBe(200)
        const body = await response.json() as { categories: Array<{ category: string; query: string; previewUrl: string | null }>; locale: string | null }
        expect(body.categories).toHaveLength(2)
        expect(body.locale).toBe('en_US')
        expect(observedPath).toBe('/api/v1/test-key/gifs/categories')
    })
})