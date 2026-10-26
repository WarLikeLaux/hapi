import { describe, expect, it, spyOn } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import type { PopularModelsResponse } from '@hapi/protocol/apiTypes'
import { Store } from '../../store'
import { encodeMessageContent } from '../../store/contentCodec'
import type { WebAppEnv } from '../middleware/auth'
import { createUsageRoutes } from './usage'

function createApp(store: Store, namespace: string): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()
    app.use('*', async (c, next) => {
        c.set('namespace', namespace)
        await next()
    })
    app.route('/api', createUsageRoutes(store))
    return app
}

async function eventually(check: () => Promise<void>): Promise<void> {
    for (let attempt = 0; ; attempt++) {
        try { await check(); return } catch (error) {
            if (attempt >= 200) throw error
            await Bun.sleep(5)
        }
    }
}

async function ranking(app: Hono<WebAppEnv>): Promise<PopularModelsResponse> {
    const response = await app.request('/api/usage/popular-models')
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    return await response.json() as PopularModelsResponse
}

describe('GET /api/usage/summary', () => {
    it('returns a no-store summary for the hub owner', async () => {
        const store = new Store(':memory:')
        try {
            const response = await createApp(store, 'default').request('/api/usage/summary?range=30d')

            expect(response.status).toBe(200)
            expect(response.headers.get('cache-control')).toBe('no-store')
            const body = await response.json() as { range: { from: number | null; to: number | null }; totals: { requests: number } }
            expect(typeof body.range.from).toBe('number')
            expect(typeof body.range.to).toBe('number')
            expect(body.totals.requests).toBe(0)
        } finally {
            store.close()
        }
    })

    it('rejects non-default namespaces', async () => {
        const store = new Store(':memory:')
        try {
            const response = await createApp(store, 'tenant').request('/api/usage/summary')

            expect(response.status).toBe(403)
            expect(await response.json()).toEqual({ error: 'Usage summary is only available to the hub owner' })
        } finally {
            store.close()
        }
    })

    it('filters collected usage to one session without exposing other namespaces', async () => {
        const store = new Store(':memory:')
        try {
            const session = (id: string, namespace = 'default') => store.sessions.getOrCreateSession(id, { path: '/tmp', host: 'test', flavor: 'cursor' }, null, namespace)
            const first = session('first')
            const second = session('second')
            const foreign = session('foreign', 'tenant')
            for (const [id, inputTokens] of [[first.id, 12], [second.id, 100], [foreign.id, 999]] as const) {
                store.messages.addMessage(id, { role: 'agent', content: { type: 'cursor', data: { type: 'usage', model: 'recorded-model', inputTokens, outputTokens: 3 } } })
            }
            const app = createApp(store, 'default')
            const response = await app.request(`/api/usage/summary?range=all&sessionId=${first.id}`)
            expect(response.status).toBe(200)
            const body = await response.json() as { totals: { inputTokens: number; totalTokens: number; sessions: number }; byModel: Array<{ key: string }> }
            expect(body.totals).toMatchObject({ inputTokens: 12, totalTokens: 15, sessions: 1 })
            expect(body.byModel.map(bucket => bucket.key)).toEqual(['recorded-model'])
            for (const id of [foreign.id, 'missing']) {
                const denied = await app.request(`/api/usage/summary?sessionId=${id}`)
                expect(denied.status).toBe(404)
                expect(await denied.json()).toEqual({ error: 'Session not found' })
            }
            expect((await createApp(store, 'tenant').request(`/api/usage/summary?sessionId=${foreign.id}`)).status).toBe(403)
        } finally { store.close() }
    })

    it('validates IANA time zones', async () => {
        const store = new Store(':memory:')
        try {
            for (const timeZone of ['America/New_York', 'Asia/Shanghai']) {
                const response = await createApp(store, 'default').request(`/api/usage/summary?timeZone=${encodeURIComponent(timeZone)}`)
                expect(response.status).toBe(200)
            }
            for (const timeZone of ['Mars/Olympus', 'x'.repeat(101)]) {
                const response = await createApp(store, 'default').request(`/api/usage/summary?timeZone=${encodeURIComponent(timeZone)}`)
                expect(response.status).toBe(400)
            }
        } finally {
            store.close()
        }
    })
})


describe('GET /api/usage/popular-models', () => {
    it('backfills compressed legacy messages once in background and keeps the index after restart', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'hapi-legacy-model-index-'))
        const dbPath = join(directory, 'hapi.db')
        let store = new Store(dbPath)
        try {
            const session = store.sessions.getOrCreateSession('legacy', { path: '/tmp', host: 'test', flavor: 'cursor' }, null, 'tenant', 'legacy-fallback')
            // A pre-upgrade database has transcript rows but no eager usage index.
            const legacy = new Database(dbPath)
            try {
                const insert = legacy.prepare('INSERT INTO messages (id, session_id, seq, content, created_at, invoked_at) VALUES (?, ?, ?, ?, ?, ?)')
                const now = Date.now()
                const content = encodeMessageContent({ role: 'agent', content: { type: 'cursor', data: {
                    type: 'usage', model: 'composer-2.5-fast', inputTokens: 2, padding: 'legacy'.repeat(300),
                } } })
                legacy.transaction(() => {
                    for (let seq = 1; seq <= 205; seq++) insert.run(`legacy-${seq}`, session.id, seq, content, now, now)
                })()
            } finally { legacy.close() }
            const read = store.messages.getMessagesAfterSeq.bind(store.messages)
            let arrived = false
            const duringBackfill = spyOn(store.messages, 'getMessagesAfterSeq').mockImplementation((id, afterSeq, limit) => {
                // Deliver a live model change after the first page has yielded.
                if (afterSeq > 0 && !arrived) {
                    arrived = true
                    store.sessions.setSessionModel(session.id, 'grok-4.7-xhigh', 'tenant')
                    store.messages.addMessage(session.id, { role: 'agent', content: { type: 'cursor', data: { type: 'usage', inputTokens: 2 } } })
                }
                return read(id, afterSeq, limit)
            })
            const app = createApp(store, 'tenant')
            expect((await ranking(app)).models).toEqual([])
            await eventually(async () => {
                expect((await ranking(app)).models.map(pair => pair.model).sort()).toEqual(['composer-2.5', 'grok-4.7-xhigh'])
                expect(store.usage.getPendingSessionIds('tenant')).toEqual([])
            })
            duringBackfill.mockRestore()
            store.close()
            store = new Store(dbPath)
            const transcript = spyOn(store.messages, 'getMessagesAfterSeq').mockImplementation(() => { throw new Error('Unexpected legacy rescan') })
            expect((await ranking(createApp(store, 'tenant'))).models.map(pair => pair.model).sort()).toEqual(['composer-2.5', 'grok-4.7-xhigh'])
            expect(transcript).not.toHaveBeenCalled()
            transcript.mockRestore()
        } finally {
            store.close()
            await rm(directory, { recursive: true, force: true })
        }
    })

    it('counts distinct weekly chats per executor/model, merges speeds, pages history and isolates namespaces', async () => {
        const now = 1_800_000_000_000
        const clock = spyOn(Date, 'now').mockReturnValue(now)
        const store = new Store(':memory:')
        try {
            const session = (tag: string, agent: string, namespace = 'tenant') => store.sessions.getOrCreateSession(tag, { path: '/tmp', host: 'test', flavor: agent }, null, namespace)
            const usage = (id: string, model: string, at: number) => store.messages.copyMessageToSession(id, {
                content: { role: 'agent', content: { type: 'cursor', data: { type: 'usage', model, inputTokens: 2, outputTokens: 1 } } },
                createdAt: at, invokedAt: at, localId: null, scheduledAt: null,
            })
            const first = session('first', 'cursor')
            for (let index = 0; index < 205; index++) usage(first.id, 'composer-2.5-fast', now - 100_000 + index)
            usage(first.id, 'grok-4.7-xhigh', now - 10_000)
            const second = session('second', 'cursor')
            usage(second.id, 'composer-2.5[fast=false]', now - 7 * 86_400_000)
            usage(second.id, 'too-old', now - 7 * 86_400_000 - 1)
            usage(second.id, 'in-the-future', now + 1)
            const otherExecutor = session('other-executor', 'opencode')
            usage(otherExecutor.id, 'composer-2.5', now - 1000)
            const stranger = session('private', 'cursor', 'default')
            usage(stranger.id, 'private-model', now)
            session('empty', 'cursor')

            const app = createApp(store, 'tenant')
            await eventually(async () => expect(await ranking(app)).toEqual({
                range: { from: now - 7 * 86_400_000, to: now },
                models: [
                    { agent: 'cursor', model: 'composer-2.5', sessionCount: 2, lastUsedAt: now - 100_000 + 204 },
                    { agent: 'opencode', model: 'composer-2.5', sessionCount: 1, lastUsedAt: now - 1000 },
                    { agent: 'cursor', model: 'grok-4.7-xhigh', sessionCount: 1, lastUsedAt: now - 10_000 },
                ],
            }))
            await eventually(async () => expect(store.usage.getPendingSessionIds('tenant')).toEqual([]))
        } finally {
            store.close()
            clock.mockRestore()
        }
    })

    it('updates the persisted SQL ranking on real usage, survives restart and expires the rolling window without a rescan', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'hapi-popular-index-'))
        const dbPath = join(directory, 'hapi.db')
        const now = 1_800_000_000_000
        const clock = spyOn(Date, 'now').mockReturnValue(now)
        let store = new Store(dbPath)
        const addUsage = (sessionId: string, model: string) => store.messages.addMessage(sessionId, {
            role: 'agent', content: { type: 'cursor', data: { type: 'usage', model, inputTokens: 2 } },
        })
        try {
            const session = store.sessions.getOrCreateSession('used', { path: '/tmp', host: 'test', flavor: 'cursor' }, null, 'tenant')
            const app = createApp(store, 'tenant')
            const blank = store.sessions.getOrCreateSession('empty', { path: '/tmp', host: 'test', flavor: 'cursor' }, null, 'tenant', 'unused')
            const stranger = store.sessions.getOrCreateSession('stranger', { path: '/tmp', host: 'test', flavor: 'cursor' }, null, 'private')
            addUsage(stranger.id, 'private-model')
            addUsage(session.id, 'composer-2.5-fast')
            let result = await ranking(app)
            expect(result.models.map(pair => [pair.model, pair.sessionCount])).toEqual([['composer-2.5', 1]])
            await eventually(async () => expect(store.usage.getPendingSessionIds('tenant')).toEqual([]))
            expect((await ranking(app)).models.some(pair => pair.model === 'unused')).toBe(false)
            clock.mockReturnValue(now + 1000)
            store.messages.addMessage(session.id, { role: 'user', content: { type: 'text', text: 'retry here' } }, 'rewind-here')
            addUsage(session.id, 'grok-4.7-xhigh')
            result = await ranking(app)
            expect(result.models.map(pair => pair.model)).toEqual(['grok-4.7-xhigh', 'composer-2.5'])
            addUsage(blank.id, 'composer-2.5[fast=false]')
            expect((await ranking(app)).models[0]).toMatchObject({ model: 'composer-2.5', sessionCount: 2 })
            store.messages.truncateMessagesFromLocalId(session.id, 'rewind-here')
            await eventually(async () => {
                result = await ranking(app)
                expect(result.models.map(pair => [pair.model, pair.sessionCount])).toEqual([['composer-2.5', 2]])
                expect(store.usage.getPendingSessionIds('tenant')).toEqual([])
            })
            store.close()
            store = new Store(dbPath)
            const restarted = createApp(store, 'tenant')
            // A warm request must not decode transcript blobs at all.
            const transcript = spyOn(store.messages, 'getMessagesAfterSeq').mockImplementation(() => { throw new Error('Unexpected rescan') })
            expect(await ranking(restarted)).toEqual(result)
            clock.mockReturnValue(now + 7 * 86_400_000 + 1)
            expect((await ranking(restarted)).models.map(pair => [pair.model, pair.sessionCount])).toEqual([['composer-2.5', 1]])
            clock.mockReturnValue(now + 7 * 86_400_000 + 1001)
            expect((await ranking(restarted)).models).toEqual([])
            expect(transcript).not.toHaveBeenCalled()
            transcript.mockRestore()
        } finally {
            store.close()
            clock.mockRestore()
            await rm(directory, { recursive: true, force: true })
        }
    })
})
