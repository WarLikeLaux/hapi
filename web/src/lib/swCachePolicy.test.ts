import { describe, expect, it } from 'vitest'
import { cacheJavaScriptOnly } from './swCachePolicy'

function redirectedResponse(body: string): Response {
    // Response objects built in tests cannot set `redirected`; model one that came through a redirect.
    const inner = new Response(body, { status: 200, statusText: 'OK', headers: { 'content-type': 'application/json' } })
    return {
        redirected: true,
        status: 200,
        statusText: 'OK',
        headers: inner.headers,
        arrayBuffer: () => inner.arrayBuffer(),
    } as unknown as Response
}

describe('optional syntax module cache', () => {
    it('stores JavaScript but rejects login HTML, redirects and failures', async () => {
        for (const type of ['text/javascript', 'application/javascript; charset=utf-8']) {
            const response = new Response('export default []', { headers: { 'content-type': type } })
            expect(await cacheJavaScriptOnly.cacheWillUpdate({ response })).toBe(response)
        }
        for (const response of [
            new Response('<html>Login</html>', { headers: { 'content-type': 'text/html' } }),
            new Response('unavailable', { status: 503, headers: { 'content-type': 'text/javascript' } }),
            new Response('unknown content type'),
            redirectedResponse('redirected'),
        ]) {
            expect(await cacheJavaScriptOnly.cacheWillUpdate({ response })).toBeNull()
        }
    })
})
