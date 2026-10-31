import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import { Database } from 'bun:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SignJWT } from 'jose'
import { Store } from '../../store'
import { createAuthMiddleware, type WebAppEnv } from '../middleware/auth'
import { createProjectPreferenceRoutes } from './projectPreferences'

const secret = new TextEncoder().encode('project-preferences-test-secret')
async function headers(namespace: string) {
    const token = await new SignJWT({ uid: 1, ns: namespace }).setProtectedHeader({ alg: 'HS256' }).sign(secret)
    return { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
}

describe('project preferences', () => {
    it('migrates an existing version 44 database while keeping sessions', () => {
        const dir = mkdtempSync(join(tmpdir(), 'hapi-project-migration-'))
        const path = join(dir, 'hapi.db')
        try {
            const before = new Store(path)
            const session = before.sessions.getOrCreateSession('existing', { path: '/code/old' }, null, 'default')
            before.close()
            const raw = new Database(path)
            raw.exec('DROP TABLE project_preferences; PRAGMA user_version = 44')
            raw.close()
            const after = new Store(path)
            expect(after.sessions.getSessionByNamespace(session.id, 'default')).not.toBeNull()
            expect(after.projectPreferences.list('default')).toEqual([])
            after.close()
        } finally { rmSync(dir, { recursive: true, force: true }) }
    })

    it('persists ordered projects independently of sessions and isolates namespaces', async () => {
        const store = new Store(':memory:')
        try {
            const app = new Hono<WebAppEnv>()
            app.use('/api/*', createAuthMiddleware(secret))
            app.route('/api', createProjectPreferenceRoutes(store))
            const first = await headers('default')
            const other = await headers('other')
            const projects = [{ machineId: 'm1', path: '/code/hapi', alias: 'HAPI', section: 'work', priority: true, isDefault: true }]
            expect((await app.request('/api/project-preferences', { method: 'PUT', headers: first, body: JSON.stringify(projects) })).status).toBe(200)
            expect(await (await app.request('/api/project-preferences', { headers: first })).json()).toEqual({ projects })
            expect(await (await app.request('/api/project-preferences', { headers: other })).json()).toEqual({ projects: [] })
            expect((await app.request('/api/project-preferences', { method: 'PUT', headers: first, body: JSON.stringify([{ ...projects[0], path: 'relative' }]) })).status).toBe(400)
            expect((await app.request('/api/project-preferences', { method: 'PUT', headers: first, body: JSON.stringify([...projects, { ...projects[0], path: '/other' }]) })).status).toBe(400)
        } finally { store.close() }
    })
})
