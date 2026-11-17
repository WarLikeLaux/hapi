import { describe, expect, it } from 'bun:test'
import { MACHINE_CAPABILITIES, RPC_METHODS, type SessionGroup, type SessionSummary } from '@hapi/protocol'
import { Hono } from 'hono'
import type { SessionProcessIdentity } from '@hapi/protocol/schemas'
import { registerSessionHandlers } from '../socket/handlers/cli/sessionHandlers'
import { RpcRegistry } from '../socket/rpcRegistry'
import { Store } from '../store'
import type { WebAppEnv } from '../web/middleware/auth'
import { createGroupsRoutes } from '../web/routes/groups'
import { createSessionsRoutes } from '../web/routes/sessions'
import { SyncEngine } from './syncEngine'

describe('upgrading session processes', () => {
    it.each([true, false])('keeps the group when an idle chat upgrades (old CLI flushes archive metadata: %s)', async flushArchive => {
        const store = new Store(':memory:')
        const registry = new RpcRegistry()
        const rpcCalls: Array<{ method: string; params: unknown }> = []
        const stalePid = 100
        const currentPid = 200
        const machineId = 'machine'
        const namespace = 'default'
        const sockets = new Map<string, unknown>()
        const engine = new SyncEngine(
            store, { of: () => ({ sockets, to: () => ({ emit() {} }) }) } as never, registry, { broadcast() {} } as never,
            { autoRestoreSessions: true, autoRestoreDelayMs: 0 }
        )
        const addSession = (tag: string, pid: number, thinking: boolean) => {
            const session = engine.getOrCreateSession(tag, {
                path: '/tmp/project',
                host: 'localhost',
                hostPid: pid,
                hostStartMarker: String(pid),
                machineId,
                flavor: 'codex',
                codexSessionId: `${tag}-thread`,
                startedBy: 'runner',
                lifecycleState: 'running',
            }, { startingMode: 'remote' }, namespace, 'gpt-6.2-sol', undefined, 'medium')
            engine.handleSessionAlive({ sid: session.id, time: Date.now(), thinking, serviceTier: 'fast' })
            return session
        }

        try {
            engine.getOrCreateMachine(machineId, {
                host: 'localhost',
                platform: 'linux',
                happyCliVersion: '1',
                capabilities: [MACHINE_CAPABILITIES.FindStaleSessionProcesses],
            }, { status: 'running', pid: 1, startedAt: 1 }, namespace)
            const stale = addSession('stale', stalePid, true)
            const current = addSession('current', currentPid, false)
            const other = engine.getOrCreateSession('other', { path: '/tmp/project', host: 'localhost' }, null, namespace)
            const created = store.groups.create(namespace, 'Upgrade test')
            const group = store.groups.update(namespace, created.id, { ...created, members: [
                { sessionId: current.id, pinned: true },
                { sessionId: stale.id, pinned: true },
                { sessionId: other.id, pinned: false },
            ] })
            const app = new Hono<WebAppEnv>()
            app.use('*', async (c, next) => { c.set('namespace', namespace); await next() })
            app.route('/', createGroupsRoutes(() => engine))
            app.route('/', createSessionsRoutes(() => engine))
            const readWorkspace = async () => {
                const response = await app.request(`/groups/${group.id}`)
                expect(response.status).toBe(200)
                return await response.json() as { group: SessionGroup; sessions: SessionSummary[] }
            }

            let workspaceBeforeSpawn: Awaited<ReturnType<typeof readWorkspace>> | undefined
            let resolveResume!: () => void
            const resumed = new Promise<void>(resolve => { resolveResume = resolve })
            const handlers = new Map<string, (data: unknown, ack: (result: unknown) => void) => void>()
            const updateCliMetadata = (lifecycleState: 'archived' | 'running') => {
                const row = store.sessions.getSession(stale.id)!
                const lifecycleMetadata = lifecycleState === 'archived'
                    ? { archivedBy: 'cli', restoreOnRestart: false }
                    : { hostPid: 300, hostStartMarker: '300' }
                handlers.get('update-metadata')!({
                    sid: stale.id,
                    metadata: {
                        ...row.metadata as object,
                        lifecycleState,
                        lifecycleStateSince: Date.now(),
                        ...lifecycleMetadata,
                    },
                    expectedVersion: row.metadataVersion,
                }, result => expect(result).toMatchObject({ result: 'success' }))
            }
            const socket = {
                id: 'test-socket',
                on(event: string, handler: (data: unknown, ack: (result: unknown) => void) => void) {
                    handlers.set(event, handler)
                    return this
                },
                to: () => ({ emit() {} }),
                timeout() { return this },
                async emitWithAck(_: string, request: { method: string; params: string }) {
                    const params = JSON.parse(request.params)
                    rpcCalls.push({ method: request.method, params })
                    if (request.method === `${machineId}:${RPC_METHODS.FindStaleSessionProcesses}`) {
                        return (params as SessionProcessIdentity[]).map(process => process.pid).filter(pid => pid === stalePid)
                    }
                    if (request.method.endsWith(':' + RPC_METHODS.KillSession)) {
                        if (flushArchive) updateCliMetadata('archived')
                        return { success: true }
                    }
                    if (request.method.endsWith(':' + RPC_METHODS.StopSession)) return { success: true, status: 'stopped' }
                    if (request.method.endsWith(':' + RPC_METHODS.SpawnHappySession)) {
                        workspaceBeforeSpawn = await readWorkspace()
                        updateCliMetadata('running')
                        engine.handleSessionAlive({ sid: params.existingSessionId, time: Date.now(), thinking: false })
                        engine.handleSessionReady({ sid: params.existingSessionId, time: Date.now() })
                        resolveResume()
                        return { type: 'success', sessionId: params.existingSessionId }
                    }
                    throw new Error(`Unexpected RPC: ${request.method}`)
                },
            }
            registerSessionHandlers(socket as never, {
                store,
                resolveSessionAccess: () => ({ ok: true, value: store.sessions.getSession(stale.id)! }),
                emitAccessError() {},
                onWebappEvent: event => engine.handleRealtimeEvent(event),
            })
            sockets.set(socket.id, socket)
            for (const method of [
                `${machineId}:${RPC_METHODS.FindStaleSessionProcesses}`,
                `${machineId}:${RPC_METHODS.StopSession}`,
                `${machineId}:${RPC_METHODS.SpawnHappySession}`,
                `${stale.id}:${RPC_METHODS.KillSession}`,
                `${current.id}:${RPC_METHODS.KillSession}`,
            ]) registry.register(socket as never, method)

            engine.handleMachineAlive({ machineId, time: Date.now() })
            await Bun.sleep(0)
            expect(rpcCalls.some(call => call.method.endsWith(':' + RPC_METHODS.KillSession))).toBe(false)
            expect(engine.getSession(stale.id)?.thinking).toBe(true)

            engine.handleSessionIdle(stale.id, Date.now())
            engine.handleMachineAlive({ machineId, time: Date.now() })
            await Promise.race([resumed, Bun.sleep(1_000).then(() => { throw new Error('Expected session to resume') })])
            expect(rpcCalls.filter(call => call.method.endsWith(':' + RPC_METHODS.KillSession))).toEqual([
                { method: `${stale.id}:${RPC_METHODS.KillSession}`, params: {} },
            ])
            expect(rpcCalls.at(-1)).toMatchObject({
                method: `${machineId}:${RPC_METHODS.SpawnHappySession}`,
                params: {
                    existingSessionId: stale.id,
                    resumeSessionId: 'stale-thread',
                    serviceTier: 'fast',
                    model: 'gpt-6.2-sol',
                    modelReasoningEffort: 'medium',
                    freshGeneration: true,
                },
            })
            await Bun.sleep(0)
            expect(engine.getSession(stale.id)?.active).toBe(true)
            expect(engine.getSession(current.id)?.active).toBe(true)
            expect(workspaceBeforeSpawn?.group).toEqual(group)
            const sessionBeforeSpawn = workspaceBeforeSpawn?.sessions.find(session => session.id === stale.id)
            expect(sessionBeforeSpawn?.active).toBe(false)
            expect(sessionBeforeSpawn?.metadata?.lifecycleState).not.toBe('archived')
            expect((await readWorkspace()).group).toEqual(group)

            const archived = await app.request(`/sessions/${stale.id}/archive`, { method: 'POST' })
            expect(archived.status).toBe(200)
            expect(engine.getSession(stale.id)?.metadata?.lifecycleState).toBe('archived')
            expect((await readWorkspace()).group.members).toEqual([
                { sessionId: current.id, pinned: true },
                { sessionId: other.id, pinned: false },
            ])
        } finally {
            engine.stop()
            store.close()
        }
    })
})
