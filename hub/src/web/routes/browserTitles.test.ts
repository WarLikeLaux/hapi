import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import { Database } from 'bun:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SignJWT } from 'jose'
import { Store } from '../../store'
import { createAuthMiddleware, type WebAppEnv } from '../middleware/auth'
import { createBrowserTitleRoutes } from './browserTitles'

const secret = new TextEncoder().encode('browser-titles-test-secret')
async function headers(namespace: string) {
    const token = await new SignJWT({ uid: 1, ns: namespace }).setProtectedHeader({ alg: 'HS256' }).sign(secret)
    return { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
}

describe('browser titles', () => {
    it('migrates and persists titles across restarts, isolated by namespace', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'hapi-browser-titles-'))
        const path = join(dir, 'hapi.db')
        try {
            const original = new Store(path)
            original.close()
            const raw = new Database(path)
            raw.exec('DROP TABLE browser_titles; PRAGMA user_version = 48')
            raw.close()
            let store = new Store(path)
            const app = new Hono<WebAppEnv>()
            app.use('/api/*', createAuthMiddleware(secret))
            app.route('/api', createBrowserTitleRoutes(store))
            const first = await headers('default')
            const other = await headers('other')
            expect(await (await app.request('/api/browser-titles', { headers: first })).json()).toEqual({ work: 'HAPI', regular: 'HAPI' })
            const titles = { work: 'Work title', regular: 'Personal title' }
            expect((await app.request('/api/browser-titles', { method: 'PUT', headers: first, body: JSON.stringify(titles) })).status).toBe(200)
            expect((await app.request('/api/browser-titles', { method: 'PUT', headers: first, body: JSON.stringify({ ...titles, work: ' ' }) })).status).toBe(400)
            expect(await (await app.request('/api/browser-titles', { headers: other })).json()).toEqual({ work: 'HAPI', regular: 'HAPI' })
            store.close()
            store = new Store(path)
            expect(store.browserTitles.get('default')).toEqual(titles)
            store.close()
        } finally { rmSync(dir, { recursive: true, force: true }) }
    })
})
