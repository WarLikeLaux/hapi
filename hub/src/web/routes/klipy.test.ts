import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { Hono } from 'hono'
import { createKlipyRoutes } from './klipy'
import type { WebAppEnv } from '../middleware/auth'

/**
 * Tests for the KLIPY GIF proxy. The hub holds the partner key server-side —
 * we exercise the route with a stubbed `getConfiguration` so the tests stay
 * hermetic and never touch the network.
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

function payloadFor(gifs: Array<{ id: string; title?: string; preview?: string; download?: string }>) {
    return {
        data: gifs.map((gif) => ({
            id: gif.id,
            title: gif.title ?? 'GIF',
            slug: gif.id,
            url: `https://klipy.example/gifs/${gif.id}`,
            images: {
                fixed_width_small_still: { url: `https://klipy.example/still-small/${gif.id}.jpg`, width: 100, height: 100 },
                fixed_width_small: { url: `https://klipy.example/anim-small/${gif.id}.gif`, width: 200, height: 200 },
                fixed_width: { url: gif.download ?? `https://klipy.example/download/${gif.id}.gif`, width: 400, height: 400 },
                original: { url: `https://klipy.example/original/${gif.id}.gif`, width: 480, height: 270 }
            }
        })),
        meta: { next: 'cursor-abc' }
    }
}

describe('klipy proxy routes', () => {
    let getConfiguration: typeof import('../../configuration').getConfiguration
    let configSpy: ReturnType<typeof spyOn>

    beforeEach(async () => {
        const cfgModule = await import('../../configuration')
        getConfiguration = cfgModule.getConfiguration
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

    it('searches and normalises the upstream payload', async () => {
        const fetchMock = mock(async (input: Request | string | URL) => {
            const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
            expect(url).toContain('api.klipy.com/api/v1/gifs/search')
            expect(url).toContain('q=cat')
            expect(url).toContain('api_key=test-key')
            return new Response(JSON.stringify(payloadFor([{ id: 'g1', title: 'Cat dance' }])), {
                status: 200,
                headers: { 'content-type': 'application/json' }
            })
        })
        globalThis.fetch = fetchMock as unknown as typeof fetch

        const response = await app().request('/klipy/search?q=cat')
        expect(response.status).toBe(200)
        const body = await response.json() as { gifs: Array<{ id: string; title: string; previewUrl: string | null; downloadUrl: string | null }>; next: string | null }
        expect(body.gifs).toHaveLength(1)
        expect(body.gifs[0]).toMatchObject({ id: 'g1', title: 'Cat dance' })
        expect(body.gifs[0].previewUrl).toContain('still-small/g1.jpg')
        expect(body.gifs[0].downloadUrl).toContain('anim-small/g1.gif')
        expect(body.next).toBe('cursor-abc')
    })

    it('caps `limit` to keep the test key within budget', async () => {
        let observedUrl: string = ''
        const fetchMock = mock(async (input: Request | string | URL) => {
            const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
            observedUrl = url
            return new Response(JSON.stringify(payloadFor([])), { status: 200, headers: { 'content-type': 'application/json' } })
        })
        globalThis.fetch = fetchMock as unknown as typeof fetch

        const response = await app().request('/klipy/search?q=dog&limit=999')
        expect(response.status).toBe(200)
        expect(observedUrl).toContain('limit=24')
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

    it('returns the trending endpoint without requiring `q`', async () => {
        let observedPath: string = ''
        const fetchMock = mock(async (input: Request | string | URL) => {
            const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
            observedPath = new URL(url).pathname
            return new Response(JSON.stringify(payloadFor([{ id: 't1' }])), { status: 200, headers: { 'content-type': 'application/json' } })
        })
        globalThis.fetch = fetchMock as unknown as typeof fetch

        const response = await app().request('/klipy/trending')
        expect(response.status).toBe(200)
        expect(observedPath).toBe('/api/v1/gifs/trending')
    })
})