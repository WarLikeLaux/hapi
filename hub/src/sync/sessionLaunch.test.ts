import { afterEach, describe, expect, it } from 'bun:test'
import { Server } from 'socket.io'
import { Hono } from 'hono'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Database } from 'bun:sqlite'
import { MACHINE_CAPABILITIES, type LaunchSessionRequest, type LaunchSessionResult } from '@hapi/protocol'
import { Store } from '../store'
import { RpcRegistry } from '../socket/rpcRegistry'
import { SyncEngine } from './syncEngine'
import { createMachinesRoutes } from '../web/routes/machines'
import type { WebAppEnv } from '../web/middleware/auth'

type Gateway = { spawnSession: (...args: unknown[]) => Promise<{ type: 'success'; sessionId: string } | { type: 'error'; message: string; childStarted?: boolean }> }
const cleanup: (() => void)[] = []
afterEach(() => { for (const clean of cleanup.splice(0).reverse()) clean() })
function setup(path = ':memory:') {
    const store = new Store(path)
    const io = new Server()
    const engine = new SyncEngine(store, io, new RpcRegistry(), { broadcast() {} } as never)
    cleanup.push(() => { engine.stop(); store.close() })
    engine.getOrCreateMachine('machine', { host: 'localhost', platform: 'linux', happyCliVersion: '1.0', capabilities: [MACHINE_CAPABILITIES.AgentAvailability] }, null, 'owner')
    engine.handleMachineAlive({ machineId: 'machine', time: Date.now() })
    const gateway = (engine as unknown as { rpcGateway: Gateway }).rpcGateway
    const app = new Hono<WebAppEnv>()
    app.use('*', async (c, next) => { c.set('namespace', c.req.header('x-test-namespace') ?? 'owner'); await next() })
    app.route('/api', createMachinesRoutes(() => engine))
    const launch = async (input: LaunchSessionRequest, namespace = 'owner') => app.request('/api/machines/machine/launch', {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-test-namespace': namespace }, body: JSON.stringify(input),
    })
    return { store, engine, gateway, launch }
}
function input(overrides: Partial<LaunchSessionRequest> = {}): LaunchSessionRequest {
    return { requestId: crypto.randomUUID(), directory: '/project', agent: 'codex', initialPrompt: '  Investigate launch failures.\nKeep exact wording.  ', ...overrides }
}

describe('durable session launch', () => {
    it('queues exact prompt and group membership before dispatch, replays the receipt without another spawn or prompt', async () => {
        const { store, engine, gateway, launch } = setup()
        const group = store.groups.create('owner', 'Compare agents')
        const request = input({ groupId: group.id, model: 'chosen-model', permissionMode: 'read-only' })
        let calls = 0
        gateway.spawnSession = async (...args) => {
            calls++
            const id = args[17] as string
            expect(store.groups.forSession('owner', id)?.id).toBe(group.id)
            expect(store.messages.getUninvokedLocalMessages(id).map(row => row.content)).toEqual([
                expect.objectContaining({ role: 'user', content: expect.objectContaining({ text: request.initialPrompt }) }),
            ])
            expect(args[1]).toBe('/project')
            expect(args[3]).toBe('chosen-model')
            expect(args[10]).toBe('read-only')
            return { type: 'success', sessionId: id }
        }
        const first = await (await launch(request)).json() as LaunchSessionResult
        expect(first.state).toBe('succeeded')
        expect(await (await launch(request)).json()).toEqual(first)
        expect(calls).toBe(1)
        const machine = engine.getMachineByNamespace('machine', 'owner')!
        machine.metadata!.capabilities = []
        expect(await (await launch(request)).json()).toEqual(first)
        expect(calls).toBe(1)
        expect(store.messages.getAllMessages(first.sessionId!)).toHaveLength(1)
        expect((await launch({ ...request, initialPrompt: 'Different prompt' })).status).toBe(409)
        expect((await launch(request, 'other-namespace')).status).toBe(403)
    })

    it('runs independent launches concurrently and retries only a confirmed pre-exec failure with a new ID', async () => {
        const { store, gateway, launch } = setup()
        let release!: () => void
        const wait = new Promise<void>(resolve => { release = resolve })
        let calls = 0
        gateway.spawnSession = async (...args) => {
            calls++
            if (args[1] === '/slow') { await wait; return { type: 'success', sessionId: args[17] as string } }
            return { type: 'error', message: 'Agent unavailable', childStarted: false }
        }
        const slow = input({ directory: '/slow', initialPrompt: '' })
        const failed = input({ directory: '/missing', agent: 'pi', initialPrompt: 'Own task only' })
        const pending = launch(slow)
        const rejection = await (await launch(failed)).json()
        expect(rejection).toEqual({ state: 'failed', message: 'Agent unavailable' })
        expect(calls).toBe(2)
        expect(store.sessions.getSessions()).toHaveLength(1)
        expect(await (await launch(failed)).json()).toEqual(rejection)
        expect(calls).toBe(2)
        gateway.spawnSession = async (...args) => { calls++; return { type: 'success', sessionId: args[17] as string } }
        const retried = await (await launch({ ...failed, requestId: crypto.randomUUID() })).json() as LaunchSessionResult
        expect(retried.state).toBe('succeeded')
        release()
        const succeeded = await (await pending).json() as LaunchSessionResult
        expect(succeeded.state).toBe('succeeded')
        expect(store.messages.getAllMessages(succeeded.sessionId!)).toHaveLength(0)
        expect(store.messages.getAllMessages(retried.sessionId!)).toHaveLength(1)
        expect(calls).toBe(3)
    })

    it('deduplicates overlapping requests and keeps an ambiguous receipt across hub restart and late adoption', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'hapi-launch-'))
        cleanup.push(() => rmSync(dir, { recursive: true, force: true }))
        const path = join(dir, 'hub.db')
        const first = setup(path)
        let release!: () => void
        const wait = new Promise<void>(resolve => { release = resolve })
        let calls = 0
        first.gateway.spawnSession = async () => { calls++; await wait; return { type: 'error', message: 'RPC timed out' } }
        const request = input()
        const a = first.launch(request)
        const b = first.launch(request)
        await Bun.sleep(5)
        release()
        const unknown = await (await a).json() as LaunchSessionResult
        expect(await (await b).json()).toEqual(unknown)
        expect(unknown.state).toBe('indeterminate')
        expect(unknown.sessionId!).toBeString()
        expect(calls).toBe(1)
        first.engine.stop()
        const restarted = setup(path)
        restarted.gateway.spawnSession = async () => { throw new Error('must not respawn') }
        expect(await (await restarted.launch(request)).json()).toEqual(unknown)
        restarted.engine.adoptPreallocatedSession(unknown.sessionId!, 'cli-tag', { path: '/project', flavor: 'codex', hostPid: 456 }, null, 'owner')
        expect(await (await restarted.launch(request)).json()).toEqual({ state: 'succeeded', sessionId: unknown.sessionId })
        expect(restarted.store.messages.getAllMessages(unknown.sessionId!)).toHaveLength(1)
    })

    it('migrates a version 40 store and preserves its chats and launch receipts after reopen', () => {
        const dir = mkdtempSync(join(tmpdir(), 'hapi-launch-migration-'))
        cleanup.push(() => rmSync(dir, { recursive: true, force: true }))
        const path = join(dir, 'hub.db')
        const initial = new Store(path)
        const session = initial.sessions.getOrCreateSession('existing', { path: '/existing' }, null, 'owner')
        initial.close()
        const db = new Database(path)
        db.exec('DROP TABLE session_launch_requests; PRAGMA user_version = 40')
        db.close()
        const migrated = new Store(path)
        expect(migrated.sessions.getSession(session.id)?.id).toBe(session.id)
        expect(migrated.launches.reserve('owner', 'request', 'settings')).toBe(true)
        migrated.launches.save('owner', 'request', { state: 'succeeded', sessionId: session.id })
        migrated.close()
        const reopened = new Store(path)
        expect(reopened.launches.get('owner', 'request')?.result).toEqual({ state: 'succeeded', sessionId: session.id })
        reopened.close()
    })
})
