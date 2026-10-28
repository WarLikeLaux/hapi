import { describe, expect, it } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import { SignJWT } from 'jose'
import { Store } from '../../store'
import type { WebAppEnv } from '../middleware/auth'
import { createAuthMiddleware } from '../middleware/auth'
import { createModelPreferenceRoutes } from './modelPreferences'

const secret = new TextEncoder().encode('model-preference-test-secret')

async function headers(namespace: string) {
    const token = await new SignJWT({ uid: 1, ns: namespace })
        .setProtectedHeader({ alg: 'HS256' }).sign(secret)
    return { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
}

function appFor(store: Store) {
    const app = new Hono<WebAppEnv>()
    app.use('/api/*', createAuthMiddleware(secret))
    app.route('/api', createModelPreferenceRoutes(store))
    return app
}

describe('model preferences', () => {
    it('persists pins and aliases in SQLite within the authenticated namespace', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'hapi-model-preferences-'))
        const path = join(dir, 'hapi.db')
        try {
            let store = new Store(path)
            let app = appFor(store)
            const defaultHeaders = await headers('default')
            const otherHeaders = await headers('other')
            const preference = { agent: 'codex', modelId: 'gpt-6.1-terra', pinned: true, alias: 'Terra Work', hidden: false, reasoningEffort: 'high' }
            expect((await app.request('/api/model-preferences', {
                method: 'PUT', headers: defaultHeaders, body: JSON.stringify(preference)
            })).status).toBe(200)
            expect((await app.request('/api/model-preferences/order', {
                method: 'PUT', headers: defaultHeaders,
                body: JSON.stringify({ agent: 'codex', modelIds: ['gpt-6-sol', 'gpt-6.1-terra'] })
            })).status).toBe(200)
            const otherResponse = await app.request('/api/model-preferences', { headers: otherHeaders })
            expect((await otherResponse.json() as { preferences: unknown[] }).preferences).toEqual([])
            store.close()

            store = new Store(path)
            app = appFor(store)
            const loadedResponse = await app.request('/api/model-preferences', { headers: defaultHeaders })
            const loaded = await loadedResponse.json() as { preferences: unknown[] }
            expect(loaded.preferences).toEqual([
                { agent: 'codex', modelId: 'gpt-6-sol', pinned: true, alias: null, hidden: false, reasoningEffort: null }, preference
            ])
            expect((await app.request('/api/model-preferences', {
                method: 'PUT', headers: defaultHeaders,
                body: JSON.stringify({ ...preference, pinned: false, alias: null, reasoningEffort: null })
            })).status).toBe(200)
            const clearedResponse = await app.request('/api/model-preferences', { headers: defaultHeaders })
            expect((await clearedResponse.json() as { preferences: unknown[] }).preferences).toEqual([
                { agent: 'codex', modelId: 'gpt-6-sol', pinned: true, alias: null, hidden: false, reasoningEffort: null }
            ])
            expect((await app.request('/api/model-preferences', {
                method: 'PUT', headers: defaultHeaders,
                body: JSON.stringify({ ...preference, pinned: false, hidden: true })
            })).status).toBe(200)
            const hiddenResponse = await app.request('/api/model-preferences', { headers: defaultHeaders })
            expect((await hiddenResponse.json() as { preferences: unknown[] }).preferences).toContainEqual({ ...preference, pinned: false, hidden: true })
            expect((await app.request('/api/model-preferences', {
                method: 'PUT', headers: defaultHeaders,
                body: JSON.stringify({ ...preference, agent: 'bogus' })
            })).status).toBe(400)
            store.close()
        } finally {
            rmSync(dir, { recursive: true, force: true })
        }
    })

    it('migrates existing version 43 preferences without losing aliases', () => {
        const dir = mkdtempSync(join(tmpdir(), 'hapi-model-effort-migration-'))
        const path = join(dir, 'hapi.db')
        try {
            const before = new Store(path)
            before.close()
            const db = new Database(path)
            db.exec(`DROP TABLE model_preferences;
                CREATE TABLE model_preferences (namespace TEXT NOT NULL, agent TEXT NOT NULL, model_id TEXT NOT NULL,
                    pinned INTEGER NOT NULL DEFAULT 0, alias TEXT, hidden INTEGER NOT NULL DEFAULT 0, pin_order INTEGER,
                    PRIMARY KEY (namespace, agent, model_id));
                INSERT INTO model_preferences VALUES ('default', 'codex', 'gpt-6.1-sol', 1, 'Work', 0, 1);
                PRAGMA user_version = 43;`)
            db.close()
            const after = new Store(path)
            expect(after.modelPreferences.list('default')).toEqual([
                { agent: 'codex', modelId: 'gpt-6.1-sol', pinned: true, alias: 'Work', hidden: false, reasoningEffort: null }
            ])
            after.close()
        } finally { rmSync(dir, { recursive: true, force: true }) }
    })

    it('migrates a version 42 database without dropping existing data', () => {
        const dir = mkdtempSync(join(tmpdir(), 'hapi-model-preference-migration-'))
        const path = join(dir, 'hapi.db')
        try {
            const before = new Store(path)
            before.close()
            const db = new Database(path)
            db.exec('DROP TABLE model_preferences; PRAGMA user_version = 42;')
            db.close()
            const after = new Store(path)
            expect(after.modelPreferences.list('default')).toEqual([])
            after.close()
        } finally {
            rmSync(dir, { recursive: true, force: true })
        }
    })
})
