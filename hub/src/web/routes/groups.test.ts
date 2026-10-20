import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import { Database } from 'bun:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SessionGroup, SessionGroupLifecycleResult, SyncEvent } from '@hapi/protocol'
import { Store } from '../../store'
import { SyncEngine } from '../../sync/syncEngine'
import { RpcRegistry } from '../../socket/rpcRegistry'
import type { WebAppEnv } from '../middleware/auth'
import { createGroupsRoutes } from './groups'
import { createMachinesRoutes } from './machines'
import { MACHINE_CAPABILITIES } from '@hapi/protocol'

function fixture(path = ':memory:') {
    const store = new Store(path)
    const events: SyncEvent[] = []
    const engine = new SyncEngine(store, {} as never, new RpcRegistry(), { broadcast: (event: SyncEvent) => events.push(event) } as never)
    const a = engine.getOrCreateSession('a', { path: '/work', host: 'test', name: 'Coordinator', lifecycleState: 'running' }, null, 'team')
    const b = engine.getOrCreateSession('b', { path: '/work', host: 'test', flavor: 'codex', name: 'Worker' }, { requests: { q: { tool: 'AskUserQuestion', arguments: {}, createdAt: Date.now() } } }, 'team')
    const foreign = engine.getOrCreateSession('foreign', { path: '/work', host: 'test' }, null, 'other')
    const app = new Hono<WebAppEnv>()
    app.use('*', async (c, next) => { c.set('namespace', c.req.header('X-Namespace') ?? 'team'); await next() })
    app.route('/api', createGroupsRoutes(() => engine))
    app.route('/api', createMachinesRoutes(() => engine))
    const send = (path: string, method = 'GET', body?: unknown, namespace = 'team') => app.request(`/api${path}`, { method, headers: { 'Content-Type': 'application/json', 'X-Namespace': namespace }, ...(body ? { body: JSON.stringify(body) } : {}) })
    const create = async (name: string) => (await (await send('/groups', 'POST', { name })).json() as { group: SessionGroup }).group
    return { store, engine, events, a, b, foreign, send, create, close: () => { engine.stop(); store.close() } }
}

describe('user-owned groups through hub API', () => {
    it('persists tab order, pins and independent history through migration and reopen', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'hapi-groups-'))
        const path = join(dir, 'hub.db')
        // Start with the previously shipped schema and existing chats.
        let f = fixture(path)
        const oldId = f.a.id
        f.store.messages.addMessage(oldId, { role: 'user', content: { type: 'text', text: 'Independent history' } })
        f.close()
        const db = new Database(path)
        db.exec('DROP TABLE session_group_members; DROP TABLE session_groups; PRAGMA user_version = 38')
        db.close()
        f = fixture(path)
        try {
            const group = await f.create('HAPI')
            const saved = await (await f.send(`/groups/${group.id}`, 'PUT', { ...group, name: 'HAPI workspace', members: [{ sessionId: f.b.id, pinned: false }, { sessionId: oldId, pinned: true }] })).json() as { group: SessionGroup }
            expect(saved.group.members).toEqual([{ sessionId: oldId, pinned: true }, { sessionId: f.b.id, pinned: false }])
            expect(f.events.at(-1)).toEqual({ type: 'groups-updated', namespace: 'team' })
            f.close()
            f = fixture(path)
            const info = await (await f.send(`/groups/${group.id}`)).json() as { group: SessionGroup; sessions: { id: string; metadata: { lifecycleState: string } }[] }
            expect(info.group).toEqual(saved.group)
            expect(info.sessions.map(s => s.id)).toEqual([oldId, f.b.id])
            expect(info.sessions[0].metadata.lifecycleState).toBe('running')
            expect(f.store.messages.getMessages(oldId)[0].content).toEqual({ role: 'user', content: { type: 'text', text: 'Independent history' } })
            expect(f.store.messages.getMessages(f.b.id)).toHaveLength(0)
            expect((await (await f.send(`/sessions/${oldId}/group`)).json() as { group: SessionGroup }).group.id).toBe(group.id)
        } finally { f.close(); rmSync(dir, { recursive: true, force: true }) }
    })

    it('migrates existing groups and parks/restores them durably without changing chats', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'hapi-group-park-'))
        const path = join(dir, 'hub.db')
        let f = fixture(path)
        const created = await f.create('HAPI')
        const group = f.store.groups.update('team', created.id, { ...created, members: [
            { sessionId: f.a.id, pinned: true }, { sessionId: f.b.id, pinned: false },
        ] })
        f.store.messages.addMessage(f.a.id, { role: 'user', content: { type: 'text', text: 'Keep this history' } })
        f.close()
        const legacy = new Database(path)
        legacy.exec('ALTER TABLE session_groups DROP COLUMN parked; ALTER TABLE session_groups DROP COLUMN closed; PRAGMA user_version = 41')
        legacy.close()
        f = fixture(path)
        try {
            const before = [f.store.sessions.getSession(f.a.id), f.store.sessions.getSession(f.b.id)]
            expect(f.store.groups.get('team', group.id)?.parked).toBe(false)
            expect((await f.send(`/groups/${group.id}`, 'PUT', { ...group, parked: true }, 'other')).status).toBe(404)
            const response = await f.send(`/groups/${group.id}`, 'PUT', { ...group, parked: true })
            expect(response.status).toBe(200)
            const parked = (await response.json() as { group: SessionGroup }).group
            expect(parked).toMatchObject({ parked: true, members: group.members })
            expect(parked.version).toBe(group.version + 1)
            expect(f.events.at(-1)).toEqual({ type: 'groups-updated', namespace: 'team' })
            expect((await f.send(`/groups/${group.id}`, 'PUT', { ...group, parked: false })).status).toBe(409)
            expect([f.store.sessions.getSession(f.a.id), f.store.sessions.getSession(f.b.id)]).toEqual(before)
            f.close()
            f = fixture(path)
            expect((await (await f.send('/groups')).json() as { groups: SessionGroup[] }).groups).toContainEqual(parked)
            // Ordinary group edits cannot accidentally restore it, including clients that omit parked.
            const { parked: _parked, ...rename } = parked
            const renamed = (await (await f.send(`/groups/${group.id}`, 'PUT', { ...rename, name: 'Renamed' })).json() as { group: SessionGroup }).group
            expect(renamed.parked).toBe(true)
            const restored = (await (await f.send(`/groups/${group.id}`, 'PUT', { ...renamed, parked: false })).json() as { group: SessionGroup }).group
            expect(restored).toMatchObject({ parked: false, members: group.members })
            expect(f.store.messages.getMessages(f.a.id)[0].content).toEqual({ role: 'user', content: { type: 'text', text: 'Keep this history' } })
            expect([f.store.sessions.getSession(f.a.id), f.store.sessions.getSession(f.b.id)]).toEqual(before)
        } finally { f.close(); rmSync(dir, { recursive: true, force: true }) }
    })

    it('closes all chats without losing tabs or history and reopens them after hub restart', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'hapi-group-close-'))
        const path = join(dir, 'hub.db')
        let f = fixture(path)
        const members = ['one', 'two'].map(name => f.engine.getOrCreateSession(`pty-${name}`, {
            path: '/work', host: 'test', flavor: 'agy', machineId: 'runner', agySessionId: `native-${name}`, lifecycleState: 'running',
        }, { startingMode: 'pty' }, 'team'))
        const created = await f.create('Workspace')
        let group = f.store.groups.update('team', created.id, { ...created, members: members.map((session, index) => ({ sessionId: session.id, pinned: index === 0 })) })
        f.store.messages.addMessage(members[0].id, { role: 'user', content: { type: 'text', text: 'Keep history' } })
        const rpc = (f.engine as unknown as { rpcGateway: { killSession: (id: string) => Promise<unknown>; stopRunnerSession: () => Promise<string> } }).rpcGateway
        const stopped: string[] = []
        rpc.killSession = async id => { stopped.push(id); return {} }
        rpc.stopRunnerSession = async () => 'stopped'
        try {
            expect((await f.send(`/groups/${group.id}/close`, 'POST', { version: group.version }, 'other')).status).toBe(404)
            const result = await (await f.send(`/groups/${group.id}/close`, 'POST', { version: group.version })).json() as SessionGroupLifecycleResult
            expect(result.failures).toEqual([])
            expect(stopped).toEqual(members.map(session => session.id))
            expect(result.group).toMatchObject({ closed: true, parked: false, members: group.members })
            for (const session of members) expect(f.engine.getSession(session.id)?.metadata?.lifecycleState).toBe('archived')
            expect((await f.send(`/groups/${group.id}/reopen`, 'POST', { version: group.version })).status).toBe(409)
            f.close()
            f = fixture(path)
            group = f.store.groups.get('team', group.id)!
            expect(group.members).toEqual(result.group.members)
            const internals = f.engine as unknown as {
                machineCache: unknown; waitForSessionActive: unknown; waitForSessionReady: unknown;
                rpcGateway: { spawnSession: (...args: unknown[]) => Promise<unknown> }
            }
            internals.machineCache = { getOnlineMachinesByNamespace: () => [{ id: 'runner', metadata: { host: 'test' } }], expireInactive() {} }
            internals.waitForSessionActive = async () => true
            internals.waitForSessionReady = async () => 'ready'
            internals.rpcGateway.spawnSession = async (...args) => ({ type: 'success', sessionId: args[12] })
            const reopened = await (await f.send(`/groups/${group.id}/reopen`, 'POST', { version: group.version })).json() as SessionGroupLifecycleResult
            expect(reopened.failures).toEqual([])
            expect(reopened.group).toMatchObject({ closed: false, parked: false, members: group.members })
            for (const session of members) expect(f.engine.getSession(session.id)?.active).toBe(true)
            expect(f.store.messages.getMessages(members[0].id)).toHaveLength(1)
        } finally { f.close(); rmSync(dir, { recursive: true, force: true }) }
    })

    it('reports partial stop failures, blocks concurrent edits and retries only remaining chats', async () => {
        const f = fixture()
        const created = await f.create('Workspace')
        const group = f.store.groups.update('team', created.id, { ...created, members: [{ sessionId: f.a.id, pinned: true }, { sessionId: f.b.id, pinned: false }] })
        const rpc = (f.engine as unknown as { rpcGateway: { killSession: (id: string) => Promise<unknown> } }).rpcGateway
        let unlock!: () => void
        const blocked = new Promise<void>(resolve => { unlock = resolve })
        let started!: () => void
        const began = new Promise<void>(resolve => { started = resolve })
        rpc.killSession = async id => {
            if (id === f.a.id) { started(); await blocked; return {} }
            throw new Error('Runner offline')
        }
        try {
            const closing = f.send(`/groups/${group.id}/close`, 'POST', { version: group.version })
            await began
            const current = f.store.groups.get('team', group.id)!
            expect((await f.send(`/groups/${group.id}`, 'PUT', { ...current, members: [] })).status).toBe(409)
            expect((await f.send(`/groups/${group.id}/reopen`, 'POST', { version: current.version })).status).toBe(409)
            unlock()
            const result = await (await closing).json() as SessionGroupLifecycleResult
            expect(result.failures).toEqual([{ sessionId: f.b.id, message: 'Runner offline' }])
            expect(result.group).toMatchObject({ closed: true, members: group.members })
            const calls: string[] = []
            rpc.killSession = async id => { calls.push(id); return {} }
            const retry = await (await f.send(`/groups/${group.id}/close`, 'POST', { version: result.group.version })).json() as SessionGroupLifecycleResult
            expect(retry.failures).toEqual([])
            expect(calls).toEqual([f.b.id])
            const reopen = await (await f.send(`/groups/${group.id}/reopen`, 'POST', { version: retry.group.version })).json() as SessionGroupLifecycleResult
            expect(reopen.failures.map(failure => failure.sessionId)).toEqual([f.a.id, f.b.id])
            expect(reopen.group).toMatchObject({ closed: true, members: group.members })
        } finally { unlock(); f.close() }
    })

    it('replays durable group creation across retries and restart, scoped by namespace', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'hapi-group-create-'))
        const path = join(dir, 'hub.db')
        let f = fixture(path)
        const existing = await f.create('Existing group')
        f.store.groups.add('team', existing.id, f.b.id)
        f.close()
        const previousDb = new Database(path)
        previousDb.exec('DROP TABLE session_group_creation_requests; PRAGMA user_version = 39')
        previousDb.close()
        f = fixture(path)
        const input = { name: '  MCP workspace  ', requestId: 'create-1' }
        const create = async (namespace = 'team', body = input) => {
            const response = await f.send('/groups', 'POST', body, namespace)
            expect(response.status).toBe(201)
            return (await response.json() as { group: SessionGroup }).group
        }
        try {
            const [group, concurrent] = await Promise.all([create(), create()])
            expect(concurrent.id).toBe(group.id)
            expect(group.name).toBe('MCP workspace')
            expect(group.members).toEqual([])
            expect(f.events.at(-1)).toEqual({ type: 'groups-updated', namespace: 'team' })
            expect(f.store.groups.forSession('team', f.a.id)).toBeNull()
            // A later user rename is retained; retries compare the original creation input.
            f.store.groups.update('team', group.id, { ...group, name: 'Renamed', members: [{ sessionId: f.a.id, pinned: true }] })
            f.close()
            f = fixture(path)
            const retried = await create()
            expect(retried).toMatchObject({ id: group.id, name: 'Renamed', members: [{ sessionId: f.a.id, pinned: true }] })
            expect((await f.send('/groups', 'POST', { ...input, name: 'Another' })).status).toBe(409)
            expect(f.store.groups.list('team')).toHaveLength(2)
            expect(f.store.groups.get('team', existing.id)?.members).toEqual([{ sessionId: f.b.id, pinned: false }])
            expect((await create('other')).id).not.toBe(group.id)
            expect((await create('team', { ...input, requestId: 'create-2' })).id).not.toBe(group.id)
            for (const name of ['', '   ', 'x'.repeat(121)]) {
                expect((await f.send('/groups', 'POST', { name, requestId: 'invalid' })).status).toBe(400)
            }
            expect((await f.send('/groups', 'POST', { name: 'Valid', requestId: ' ' })).status).toBe(400)
        } finally { f.close(); rmSync(dir, { recursive: true, force: true }) }
    })

    it('moves a chat atomically, rejects stale device edits and detaches without changing the chat', async () => {
        const f = fixture()
        try {
            const first = await f.create('First')
            const second = await f.create('Second')
            const before = f.store.sessions.getSession(f.a.id)
            const original = (await (await f.send(`/groups/${first.id}`, 'PUT', { ...first, members: [{ sessionId: f.a.id, pinned: true }] })).json() as { group: SessionGroup }).group
            const moved = (await (await f.send(`/groups/${second.id}`, 'PUT', { ...second, members: [{ sessionId: f.a.id, pinned: false }] })).json() as { group: SessionGroup }).group
            expect((await (await f.send(`/groups/${first.id}`)).json() as { group: SessionGroup }).group.members).toEqual([])
            expect((await f.send(`/groups/${first.id}`, 'PUT', original)).status).toBe(409)
            expect((await f.send(`/groups/${second.id}`, 'PUT', { ...moved, members: [] })).status).toBe(200)
            expect((await (await f.send(`/sessions/${f.a.id}/group`)).json() as { group: SessionGroup | null }).group).toBeNull()
            expect(f.store.sessions.getSession(f.a.id)).toEqual(before)
            expect((await f.send(`/groups/${first.id}/members`, 'POST', { sessionId: f.a.id })).status).toBe(200)
            const version = f.store.groups.get('team', first.id)!.version
            expect((await f.send(`/groups/${first.id}/members`, 'POST', { sessionId: f.a.id })).status).toBe(200)
            expect(f.store.groups.get('team', first.id)!.version).toBe(version)
            // Session deletion removes only membership, leaving the workspace available.
            await f.engine.deleteSession(f.a.id)
            expect(f.store.groups.get('team', first.id)?.members).toEqual([])
            expect(f.events.at(-1)).toEqual({ type: 'groups-updated', namespace: 'team' })
        } finally { f.close() }
    })

    it('removes closed chats durably without deleting history or reattaching them on reopen', async () => {
        const f = fixture()
        try {
            const group = await f.create('HAPI')
            f.store.groups.add('team', group.id, f.a.id)
            f.store.groups.add('team', group.id, f.b.id)
            f.store.messages.addMessage(f.a.id, { role: 'user', content: { type: 'text', text: 'Keep history' } })
            const beforeClose = f.store.groups.get('team', group.id)!
            const rpc = (f.engine as unknown as { rpcGateway: { killSession: () => Promise<unknown> } }).rpcGateway
            rpc.killSession = async () => ({})
            await f.engine.archiveSession(f.a.id)
            expect(f.store.groups.get('team', group.id)?.members.map(m => m.sessionId)).toEqual([f.b.id])
            expect(f.store.groups.forSession('team', f.a.id)).toBeNull()
            expect(f.store.messages.getMessages(f.a.id)).toHaveLength(1)
            expect((await f.send(`/groups/${group.id}`, 'PUT', beforeClose)).status).toBe(409)
            expect((await f.send(`/groups/${group.id}/members`, 'POST', { sessionId: f.a.id })).status).toBe(400)
            // Native self-close uses the same metadata owner as hub archive.
            const worker = f.store.sessions.getSession(f.b.id)!
            expect(f.store.sessions.updateSessionMetadata(f.b.id, { ...worker.metadata as object, lifecycleState: 'archived' }, worker.metadataVersion, 'team').result).toBe('success')
            expect(f.store.groups.get('team', group.id)?.members).toEqual([])
            const archived = f.store.sessions.getSession(f.a.id)!
            expect(f.store.sessions.updateSessionMetadata(f.a.id, { ...archived.metadata as object, lifecycleState: 'running' }, archived.metadataVersion, 'team', { allowUnarchive: true }).result).toBe('success')
            expect(f.store.groups.forSession('team', f.a.id)).toBeNull()
            expect(f.events.some(e => e.type === 'groups-updated' && e.namespace === 'team')).toBe(true)
        } finally { f.close() }
    })

    it('rejects foreign groups and chats without partial membership changes', async () => {
        const f = fixture()
        try {
            const group = await f.create('Private')
            expect((await f.send(`/groups/${group.id}`, 'GET', undefined, 'other')).status).toBe(404)
            expect((await (await f.send('/groups', 'GET', undefined, 'other')).json() as { groups: SessionGroup[] }).groups).toEqual([])
            expect((await f.send(`/groups/${group.id}`, 'PUT', { ...group, members: [{ sessionId: f.a.id, pinned: true }, { sessionId: f.foreign.id, pinned: false }] })).status).toBe(404)
            expect((await (await f.send(`/groups/${group.id}`)).json() as { group: SessionGroup }).group).toEqual(group)
            expect((await f.send(`/sessions/${f.foreign.id}/group`)).status).toBe(403)
            expect((await f.send(`/groups/${group.id}/members`, 'POST', { sessionId: f.foreign.id })).status).toBe(404)
            expect((await f.send(`/groups/${group.id}`, 'PUT', { ...group, members: [{ sessionId: f.a.id, pinned: false }, { sessionId: f.a.id, pinned: true }] })).status).toBe(400)
            expect((await f.send('/groups', 'POST', { name: '   ' })).status).toBe(400)
        } finally { f.close() }
    })

    it('assigns a spawned chat before responding and denies an inaccessible group before spawn', async () => {
        const f = fixture()
        try {
            const group = await f.create('HAPI')
            const machine = f.engine.getOrCreateMachine('runner', { host: 'test', platform: 'linux', happyCliVersion: 'test', capabilities: [MACHINE_CAPABILITIES.AgentAvailability] }, null, 'team')
            let calls = 0
            const rpc = (f.engine as unknown as { rpcGateway: { spawnSession: (...args: unknown[]) => Promise<unknown> } }).rpcGateway
            rpc.spawnSession = async (...args) => {
                calls++
                const sessionId = args.at(-1) as string
                // The agent may call MCP before the runner returns the spawn receipt.
                expect(f.store.groups.forSession('team', sessionId)?.id).toBe(group.id)
                return { type: 'success', sessionId }
            }
            const spawn = (groupId: string) => f.send(`/machines/${machine.id}/spawn`, 'POST', { directory: '/work', agent: 'codex', groupId })
            expect((await spawn('inaccessible')).status).toBe(404)
            expect(calls).toBe(0)
            const result = await spawn(group.id)
            expect(result.status).toBe(200)
            expect(f.store.groups.forSession('team', (await result.json() as { sessionId: string }).sessionId)?.id).toBe(group.id)
            expect(calls).toBe(1)
        } finally { f.close() }
    })
})
