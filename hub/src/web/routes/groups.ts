import { Hono } from 'hono'
import { z } from 'zod'
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
        const input = CreateSessionGroupSchema.extend({ requestId: z.string().trim().min(1).max(512).optional() }).safeParse(await c.req.json().catch(() => null))
        if (!input.success) return c.json({ error: 'Enter a group name (1–120 characters) and a valid request ID (1–512 characters) if supplied' }, 400)
        const namespace = c.get('namespace')
        try {
            const group = engine.groups.create(namespace, input.data.name, input.data.requestId)
            engine.publishGroupsChanged(namespace)
            return c.json({ group }, 201)
        } catch (error) {
            if (error instanceof SessionGroupError) return c.json({ error: error.message }, error.status)
            throw error
        }
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
    app.post('/groups/:id/:action', async c => {
        const action = c.req.param('action')
        if (action !== 'close' && action !== 'reopen') return c.json({ error: 'Unknown group action' }, 404)
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine
        const input = z.object({ version: z.number().int().positive() }).safeParse(await c.req.json().catch(() => null))
        if (!input.success) return c.json({ error: 'Group version is required' }, 400)
        const namespace = c.get('namespace')
        let group
        try { group = engine.groups.beginLifecycle(namespace, c.req.param('id'), input.data.version) }
        catch (error) {
            if (error instanceof SessionGroupError) return c.json({ error: error.message }, error.status)
            throw error
        }
        engine.publishGroupsChanged(namespace)
        const failures: { sessionId: string; message: string }[] = []
        try {
            // Each stop/resume uses the same process-safety checks as an individual chat.
            // Continue past failures, retaining failed tabs so the user can retry.
            for (const member of group.members) {
                try {
                    const access = engine.resolveSessionAccess(member.sessionId, namespace)
                    if (!access.ok) throw new Error('Chat is unavailable')
                    if (action === 'close') {
                        if (!access.session.active && access.session.metadata?.lifecycleState === 'archived') {
                            engine.markSessionExplicitlyStopped(member.sessionId)
                        } else await engine.archiveSession(member.sessionId)
                    } else {
                        const result = await engine.reopenSession(member.sessionId, namespace)
                        if (result.type !== 'success') throw new Error(result.message)
                    }
                } catch (error) {
                    failures.push({ sessionId: member.sessionId, message: error instanceof Error ? error.message : String(error) })
                }
            }
        } finally {
            group = engine.groups.finishLifecycle(namespace, group.id, action === 'close' || failures.length > 0)
            engine.publishGroupsChanged(namespace)
        }
        return c.json({ group, failures })
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
