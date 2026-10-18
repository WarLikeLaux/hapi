import { Hono } from 'hono'
import { CreateSessionGroupSchema, SessionGroupMemberSchema, UpdateSessionGroupSchema, toSessionSummary } from '@hapi/protocol'
import { SessionGroupError } from '../../store/sessionGroupStore'
import type { SyncEngine } from '../../sync/syncEngine'
import type { WebAppEnv } from '../middleware/auth'
import { requireSessionFromParam, requireSyncEngine } from './guards'

export function createGroupsRoutes(getSyncEngine: () => SyncEngine | null): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()
    app.get('/groups', c => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine
        return c.json({ groups: engine.groups.list(c.get('namespace')) })
    })
    app.get('/sessions/:id/group', c => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine
        const access = requireSessionFromParam(c, engine)
        if (access instanceof Response) return access
        return c.json({ group: engine.groups.forSession(c.get('namespace'), access.sessionId) })
    })
    app.get('/groups/:id', c => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine
        const namespace = c.get('namespace')
        const group = engine.groups.get(namespace, c.req.param('id'))
        if (!group) return c.json({ error: 'Group not found' }, 404)
        const sessions = group.members.flatMap(member => {
            const access = engine.resolveSessionAccess(member.sessionId, namespace)
            return access.ok ? [toSessionSummary(access.session)] : []
        })
        return c.json({ group, sessions })
    })
    app.post('/groups', async c => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine
        const input = CreateSessionGroupSchema.safeParse(await c.req.json().catch(() => null))
        if (!input.success) return c.json({ error: 'Enter a group name (1–120 characters)' }, 400)
        const namespace = c.get('namespace')
        const group = engine.groups.create(namespace, input.data.name)
        engine.publishGroupsChanged(namespace)
        return c.json({ group }, 201)
    })
    app.post('/groups/:id/members', async c => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine
        const input = SessionGroupMemberSchema.pick({ sessionId: true }).safeParse(await c.req.json().catch(() => null))
        if (!input.success) return c.json({ error: 'Chat ID is required' }, 400)
        const namespace = c.get('namespace')
        try {
            engine.groups.add(namespace, c.req.param('id'), input.data.sessionId)
            engine.publishGroupsChanged(namespace)
            return c.json({ ok: true })
        } catch (error) {
            if (error instanceof SessionGroupError) return c.json({ error: error.message }, error.status)
            throw error
        }
    })
    app.put('/groups/:id', async c => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine
        const input = UpdateSessionGroupSchema.safeParse(await c.req.json().catch(() => null))
        if (!input.success) return c.json({ error: 'Invalid group name or chat order' }, 400)
        const namespace = c.get('namespace')
        try {
            const group = engine.groups.update(namespace, c.req.param('id'), input.data)
            engine.publishGroupsChanged(namespace)
            return c.json({ group })
        } catch (error) {
            if (error instanceof SessionGroupError) return c.json({ error: error.message }, error.status)
            throw error
        }
    })
    return app
}
