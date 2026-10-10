import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { ApiSessionClient } from '@/api/apiSession'

const config = vi.hoisted(() => ({ apiUrl: '' }))
vi.mock('@/configuration', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/configuration')>()
    return { ...actual, configuration: { ...actual.configuration, get apiUrl() { return config.apiUrl } } }
})
vi.mock('@/api/auth', () => ({ getAuthToken: () => 'test-cli:team' }))

import { startHappyServer } from '@/claude/utils/startHappyServer'

type ToolReply = { isError?: boolean; content: Array<{ type: string; text?: string }> }

describe('agent launch over HTTP MCP', () => {
    let hub: Server
    let stopMcp: () => void
    let mcpUrl: string
    let clients: Client[]
    let spawnBodies: Record<string, unknown>[]
    let messageBodies: Record<string, unknown>[]
    let loseSpawnResponse: boolean
    let rejectMessageOnce: boolean
    let available: boolean

    beforeEach(async () => {
        clients = []
        spawnBodies = []
        messageBodies = []
        loseSpawnResponse = false
        rejectMessageOnce = false
        available = true
        const machine = { id: 'runner-one', metadata: { host: 'dev', workspaceRoots: ['/code'] } }
        const sessions = [
            { id: 'caller', active: true, metadata: { machineId: machine.id, path: '/code/project', flavor: 'codex' } },
            { id: 'spawned', active: true, metadata: { machineId: machine.id, path: '/code/project', flavor: 'codex' } },
        ]
        hub = createServer(async (req, res) => {
            let raw = ''
            for await (const chunk of req) raw += chunk
            const body = raw ? JSON.parse(raw) : {}
            const reply = (value: unknown, status = 200) => {
                res.writeHead(status, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify(value))
            }
            const path = req.url
            if (path === '/api/auth') {
                if (body.accessToken !== 'test-cli:team') return reply({ error: 'wrong namespace' }, 401)
                return reply({ token: 'test-jwt' })
            }
            if (req.headers.authorization !== 'Bearer test-jwt') return reply({ error: 'unauthorized' }, 401)
            if (path === '/api/machines') return reply({ machines: [machine] })
            if (path === '/api/sessions') return reply({ sessions })
            if (path === '/api/sessions/caller') return reply({ session: sessions[0] })
            if (path === '/api/sessions/spawned') return reply({ session: sessions[1] })
            if (path === '/api/machines/runner-one/list-directory') return reply({ success: true, entries: [{ name: 'project', type: 'directory' }, { name: 'other', type: 'directory' }, { name: 'readme', type: 'file' }] })
            if (path === '/api/machines/runner-one/agent-availability') return reply({ agents: [{ agent: 'codex', available, defaultModelName: 'Configured Codex' }, { agent: 'gemini', available: true }] })
            if (path === '/api/machines/runner-one/paths/exists') return reply({ exists: { '/code/project': true } })
            if (path === '/api/machines/runner-one/spawn') {
                spawnBodies.push(body)
                if (loseSpawnResponse) return req.socket.destroy()
                return reply({ type: 'success', sessionId: 'spawned' })
            }
            if (path === '/api/sessions/spawned/messages') {
                messageBodies.push(body)
                if (rejectMessageOnce) {
                    rejectMessageOnce = false
                    return reply({ error: 'temporary disconnect' }, 503)
                }
                return reply({ ok: true })
            }
            return reply({ error: `Unexpected route ${path}` }, 404)
        })
        await new Promise<void>((resolve) => hub.listen(0, '127.0.0.1', resolve))
        config.apiUrl = `http://127.0.0.1:${(hub.address() as AddressInfo).port}`
        const mcp = await startHappyServer({ sessionId: 'caller', updateMetadata: vi.fn() } as unknown as ApiSessionClient)
        stopMcp = mcp.stop
        mcpUrl = mcp.url
    })

    afterEach(async () => {
        await Promise.all(clients.map((client) => client.close()))
        stopMcp()
        hub.closeAllConnections()
        await new Promise<void>((resolve) => hub.close(() => resolve()))
    })

    async function connect() {
        const client = new Client({ name: 'launch-test', version: '1' })
        clients.push(client)
        await client.connect(new StreamableHTTPClientTransport(new URL(mcpUrl)))
        return client
    }

    const task = { project: 'project', message: 'Implement the task', requestId: 'task-1' }
    async function launch(client: Client, args = task) {
        return await client.callTool({ name: 'launch_agent', arguments: args }) as ToolReply
    }

    it('discovers workspace and recent project paths with launchable native defaults', async () => {
        const client = await connect()
        const result = await client.callTool({ name: 'list_launch_options', arguments: {} }) as ToolReply
        expect(result.isError).toBe(false)
        const options = JSON.parse(result.content[0]!.text!)
        expect(options.machines[0]).toMatchObject({ id: 'runner-one', projects: ['/code', '/code/other', '/code/project'], agents: [{ agent: 'codex', available: true, defaultModelName: 'Configured Codex' }], discoveryErrors: [] })
    })

    it('launches with native model/effort, maximum permissions and delivers the initial task', async () => {
        const result = await launch(await connect())
        expect(result.isError).toBe(false)
        expect(JSON.parse(result.content[0]!.text!)).toEqual({ sessionId: 'spawned', url: '/sessions/spawned', messageDelivered: true })
        expect(spawnBodies).toEqual([{ directory: '/code/project', agent: 'codex', permissionMode: 'yolo', yolo: true, startingMode: 'remote', sessionType: 'simple' }])
        expect(messageBodies).toEqual([{ text: task.message, localId: 'launch:caller:task-1' }])
    })

    it('coalesces concurrent launches across MCP clients and returns the receipt on retry', async () => {
        const first = await connect()
        const second = await connect()
        const results = await Promise.all([launch(first), launch(second)])
        expect(results.every((result) => !result.isError)).toBe(true)
        expect(await launch(second)).toEqual(results[0])
        expect(spawnBodies).toHaveLength(1)
        expect(messageBodies).toHaveLength(1)
        expect((await launch(first, { ...task, message: 'Different task' })).isError).toBe(true)
        expect(spawnBodies).toHaveLength(1)
    })

    it('retries failed task delivery using the existing session and same message ID', async () => {
        rejectMessageOnce = true
        const client = await connect()
        expect((await launch(client)).isError).toBe(true)
        expect((await launch(client)).isError).toBe(false)
        expect(spawnBodies).toHaveLength(1)
        expect(messageBodies).toHaveLength(2)
        expect(messageBodies[0]).toEqual(messageBodies[1])
    })

    it('never respawns after a lost spawn response', async () => {
        loseSpawnResponse = true
        const client = await connect()
        expect((await launch(client)).isError).toBe(true)
        const retry = await launch(client)
        expect(retry.isError).toBe(true)
        expect(retry.content[0]!.text).toContain('Spawn outcome is uncertain')
        expect(spawnBodies).toHaveLength(1)
        expect(messageBodies).toHaveLength(0)
    })

    it('rejects unavailable agents and missing project directories before spawning', async () => {
        const client = await connect()
        available = false
        expect((await launch(client)).content[0]!.text).toContain('unavailable')
        available = true
        expect((await launch(client, { ...task, requestId: 'task-2', project: '/missing' })).content[0]!.text).toContain('does not exist')
        expect(spawnBodies).toHaveLength(0)
    })

    it('passes explicit model, reasoning effort, permission and worktree overrides to the runner', async () => {
        const client = await connect()
        const result = await client.callTool({ name: 'launch_agent', arguments: { ...task, model: 'model-id', effort: 'xhigh', permissionMode: 'read-only', worktreeName: 'feature' } }) as ToolReply
        expect(result.isError).toBe(false)
        expect(spawnBodies[0]).toMatchObject({ model: 'model-id', modelReasoningEffort: 'xhigh', permissionMode: 'read-only', yolo: false, sessionType: 'worktree', worktreeName: 'feature' })
    })

    it('forwards a stable caller-scoped request ID for peer message retries', async () => {
        const client = await connect()
        const result = await client.callTool({ name: 'ping_peer', arguments: { sessionIdPrefix: 'spawned', message: 'Follow up', requestId: 'follow-1' } }) as ToolReply
        expect(result.isError).toBe(false)
        expect(messageBodies).toEqual([{ text: 'Follow up', localId: 'peer:caller:follow-1' }])
    })
})
