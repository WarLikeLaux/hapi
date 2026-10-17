import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import type { SyncEvent } from '@hapi/protocol'
import type { SessionsResponse } from '@hapi/protocol/apiTypes'
import { Store } from '../../store'
import { RpcRegistry } from '../../socket/rpcRegistry'
import { SyncEngine } from '../../sync/syncEngine'
import type { WebAppEnv } from '../middleware/auth'
import { createSessionsRoutes } from './sessions'

function fixture() {
    const store = new Store(':memory:')
    const events: SyncEvent[] = []
    const engine = new SyncEngine(store, {} as never, new RpcRegistry(), {
        broadcast: (event: SyncEvent) => events.push(event)
    } as never)
    const session = engine.getOrCreateSession('self-close', {
        path: '/work', host: 'test', lifecycleState: 'running'
    }, null, 'default')
    engine.handleSessionAlive({ sid: session.id, time: Date.now(), thinking: false, mode: 'remote' })
    const rpc = (engine as unknown as { rpcGateway: { killSession: () => Promise<unknown> } }).rpcGateway
    const app = new Hono<WebAppEnv>()
    app.use('*', async (c, next) => {
        c.set('namespace', 'default')
        await next()
    })
    app.route('/api', createSessionsRoutes(() => engine))
    const archive = (markRead: boolean) => app.request(`/api/sessions/${session.id}/archive`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ markRead })
    })
    return { store, engine, session, rpc, app, archive, events }
}

describe('session close read state', () => {
    it('marks successful self-close read through final messages and keeps the archive and history durable', async () => {
        const { store, engine, session, rpc, app, archive, events } = fixture()
        try {
            let finalAt = 0
            rpc.killSession = async () => {
                const final = store.messages.addMessage(session.id, {
                    role: 'agent', content: { type: 'codex', data: { type: 'message', message: 'Committed and ready' } }
                })
                finalAt = final.createdAt
                engine.handleRealtimeEvent({ type: 'message-received', sessionId: session.id, message: final })
                return {}
            }
            const response = await archive(true)
            expect(response.status).toBe(200)
            const stored = store.sessions.getSession(session.id)!
            const metadata = stored.metadata as Record<string, unknown>
            expect(metadata.lifecycleState).toBe('archived')
            expect(metadata.readThrough).toBeGreaterThanOrEqual(finalAt)
            expect(engine.getSession(session.id)?.active).toBe(false)
            expect(store.messages.getMessages(session.id)).toHaveLength(1)

            const list = await (await app.request('/api/sessions')).json() as SessionsResponse
            expect(list.sessions[0].metadata?.readThrough).toBe(metadata.readThrough as number)
            expect(events.some(event => event.type === 'session-updated' && event.data
                && 'metadata' in event.data && JSON.stringify(event.data).includes('readThrough'))).toBe(true)

            const repeated = await archive(true)
            expect(await repeated.json()).toEqual({ ok: true, alreadyArchived: true })
            const repeatedMetadata = store.sessions.getSession(session.id)!.metadata as Record<string, unknown>
            expect(repeatedMetadata.readThrough).toBeGreaterThanOrEqual(metadata.readThrough as number)

            // A stale CLI cache must not erase or roll back the hub's read mark.
            for (const readThrough of [undefined, 1]) {
                const latest = store.sessions.getSession(session.id)!
                expect(store.sessions.updateSessionMetadata(session.id, {
                    path: '/work', host: 'test', lifecycleState: 'archived', readThrough
                }, latest.metadataVersion, 'default').result).toBe('success')
                expect((store.sessions.getSession(session.id)!.metadata as Record<string, unknown>).readThrough)
                    .toBe(repeatedMetadata.readThrough)
            }
        } finally {
            engine.stop()
            store.close()
        }
    })

    it.each(['failed', 'ordinary'] as const)('does not mark read on %s archive', async (mode) => {
        const { store, engine, session, rpc, archive } = fixture()
        try {
            rpc.killSession = async () => {
                if (mode === 'failed') throw new Error('stop failed')
                return {}
            }
            const response = await archive(mode === 'failed')
            expect(response.status).toBe(mode === 'failed' ? 500 : 200)
            expect((store.sessions.getSession(session.id)!.metadata as Record<string, unknown>).readThrough).toBeUndefined()
        } finally {
            engine.stop()
            store.close()
        }
    })
})
