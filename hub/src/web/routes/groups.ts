import { Hono } from 'hono'
import { z } from 'zod'
import { CreateSessionGroupSchema, SessionGroupMemberSchema, UpdateSessionGroupSchema, isSessionBusy, toSessionSummary } from '@hapi/protocol'
import { SessionGroupError } from '../../store/sessionGroupStore'
import { SessionBusyError, type SyncEngine } from '../../sync/syncEngine'
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
        if (action !== 'close' && action !== 'reopen' && action !== 'park') return c.json({ error: 'Unknown group action' }, 404)
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine
        const input = z.object({ version: z.number().int().positive() }).safeParse(await c.req.json().catch(() => null))
        if (!input.success) return c.json({ error: 'Group version is required' }, 400)
        const namespace = c.get('namespace')
        if (action === 'park') {
            const current = engine.groups.get(namespace, c.req.param('id'))
            if (!current) return c.json({ error: 'Group not found' }, 404)
            if (current.closed) return c.json({ error: 'Open this group before parking it.' }, 409)
            if (current.version !== input.data.version) return c.json({ error: 'Group changed. Reload and try again.' }, 409)
            // Check every member before stopping the first one. parkSession also
            // checks again immediately before signalling each individual chat.
            for (const member of current.members) {
                const access = engine.resolveSessionAccess(member.sessionId, namespace)
                if (!access.ok) return c.json({ error: 'Chat is unavailable', sessionId: member.sessionId }, 409)
                if (isSessionBusy(toSessionSummary(access.session))) {
                    return c.json({ error: new SessionBusyError().message, code: 'session_busy', sessionId: member.sessionId }, 409)
                }
            }
        }
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
                    if (action === 'park') {
                        await engine.parkSession(member.sessionId)
                    } else if (action === 'close') {
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
            group = engine.groups.finishLifecycle(namespace, group.id, action === 'close' || (action === 'reopen' && failures.length > 0), action === 'park' && failures.length === 0)
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
            const current = engine.groups.get(namespace, c.req.param('id'))
            if (!current) return c.json({ error: 'Group not found' }, 404)
            if (input.data.parked !== undefined && input.data.parked !== current.parked) {
                return c.json({ error: 'Use Park group or Restore group to stop or resume its chats.' }, 409)
            }
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
