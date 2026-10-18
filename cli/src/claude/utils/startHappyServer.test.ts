import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Metadata } from '@/api/types'
import type { ApiSessionClient } from '@/api/apiSession'
import { startHappyServer, toClaudeAllowedHapiMcpTools } from './startHappyServer'

type ToolResult = {
    content?: Array<{ type: string; text?: string }>
    isError?: boolean
}

describe('startHappyServer skill_lookup', () => {
    const originalHome = process.env.HOME
    let sandboxDir: string
    let workingDirectory: string
    let client: Client | null
    let stopServer: (() => void) | null
    let sendAgentMessage: ReturnType<typeof vi.fn>

    beforeEach(async () => {
        sandboxDir = await mkdtemp(join(tmpdir(), 'hapi-skill-mcp-'))
        workingDirectory = join(sandboxDir, 'repo')
        process.env.HOME = join(sandboxDir, 'home')
        await mkdir(join(workingDirectory, '.git'), { recursive: true })
        await mkdir(process.env.HOME, { recursive: true })
        client = null
        stopServer = null
    })

    afterEach(async () => {
        await client?.close()
        stopServer?.()
        if (originalHome === undefined) {
            delete process.env.HOME
        } else {
            process.env.HOME = originalHome
        }
        await rm(sandboxDir, { recursive: true, force: true })
    })

    async function connect(enableSkillLookup = true): Promise<Client> {
        sendAgentMessage = vi.fn()
        const sessionClient = {
            updateMetadata: vi.fn(),
            sendAgentMessage,
            sendClaudeSessionMessage: vi.fn()
        } as unknown as ApiSessionClient
        const server = await startHappyServer(sessionClient, enableSkillLookup
            ? {
                skillLookup: {
                    workingDirectory,
                    flavor: 'opencode'
                }
            }
            : {})
        stopServer = server.stop

        client = new Client(
            { name: 'hapi-skill-lookup-test', version: '1.0.0' },
            { capabilities: {} }
        )
        await client.connect(new StreamableHTTPClientTransport(new URL(server.url)))
        return client
    }

    it('returns a discovered SKILL.md body', async () => {
        const skillDir = join(workingDirectory, '.agents', 'skills', 'review')
        await mkdir(skillDir, { recursive: true })
        await writeFile(join(skillDir, 'SKILL.md'), [
            '---',
            'name: review',
            'description: Review changes safely',
            '---',
            '',
            '# Review instructions',
            '',
            'Inspect the diff before editing.'
        ].join('\n'))

        const mcp = await connect()
        const result = await mcp.callTool({
            name: 'skill_lookup',
            arguments: { name: 'review' }
        }) as ToolResult

        expect(result.isError).toBe(false)
        expect(result.content?.[0]?.text).toContain('Skill: review')
        expect(result.content?.[0]?.text).toContain('Description: Review changes safely')
        expect(result.content?.[0]?.text).toContain('# Review instructions')
    })

    it('returns a tool error for an unknown skill', async () => {
        const mcp = await connect()
        const result = await mcp.callTool({
            name: 'skill_lookup',
            arguments: { name: 'missing' }
        }) as ToolResult

        expect(result.isError).toBe(true)
        expect(result.content?.[0]?.text).toContain('Skill not found: missing')
    })

    it('does not expose the fallback tool to native-skill sessions', async () => {
        const mcp = await connect(false)
        const tools = await mcp.listTools()

        expect(tools.tools.map((tool) => tool.name)).not.toContain('skill_lookup')
    })

    it('describes display_image as user output rather than image input', async () => {
        const mcp = await connect(false)
        const tools = await mcp.listTools()
        const displayImage = tools.tools.find((tool) => tool.name === 'display_image')

        expect(displayImage?.description).toContain('human user')
        expect(displayImage?.description).toContain('does not provide image input to the model')
        expect(displayImage?.description).toContain('cannot be used to read, inspect, or analyze image contents')
    })

    it('displays audio through display_media and emits a generated media message', async () => {
        const path = join(sandboxDir, 'sample.wav')
        await writeFile(path, Buffer.from('RIFFxxxxWAVE'))
        const mcp = await connect(false)

        const result = await mcp.callTool({
            name: 'display_media',
            arguments: { path, title: 'sample.wav' }
        }) as ToolResult

        expect(result.isError).toBe(false)
        expect(result.content?.[0]?.text).toContain('Displayed media: sample.wav')
        expect(sendAgentMessage).toHaveBeenCalledWith(expect.objectContaining({
            type: 'generated-image',
            fileName: 'sample.wav',
            mimeType: 'audio/wav',
            source: { ingress: 'mcp', toolName: 'display_media' }
        }))
    })

    it('preserves the source extension when display_media title omits one', async () => {
        const path = join(sandboxDir, 'plan-a.zip')
        await writeFile(path, Buffer.from([0x50, 0x4b, 0x03, 0x04]))
        const mcp = await connect(false)

        const result = await mcp.callTool({
            name: 'display_media',
            arguments: { path, title: 'Cursor Plan A Markdown 导出' }
        }) as ToolResult

        expect(result.isError).toBe(false)
        expect(result.content?.[0]?.text).toContain('Displayed media: Cursor Plan A Markdown 导出.zip')
        expect(sendAgentMessage).toHaveBeenCalledWith(expect.objectContaining({
            type: 'generated-image',
            fileName: 'Cursor Plan A Markdown 导出.zip',
            mimeType: 'application/octet-stream',
            source: { ingress: 'mcp', toolName: 'display_media' }
        }))
    })

    it('does not expose change_title when native ACP titles are enabled', async () => {
        const sessionClient = {
            updateMetadata: vi.fn(),
            sendAgentMessage: vi.fn(),
            sendClaudeSessionMessage: vi.fn()
        } as unknown as ApiSessionClient
        const server = await startHappyServer(sessionClient, { enableChangeTitle: false })
        stopServer = server.stop
        const mcp = new Client({ name: 'hapi-test', version: '1.0.0' })
        client = mcp

        await mcp.connect(new StreamableHTTPClientTransport(new URL(server.url)))
        const tools = await mcp.listTools()

        expect(server.toolNames).not.toContain('change_title')
        expect(tools.tools.map((tool) => tool.name)).not.toContain('change_title')
    })

    it('persists direct platform change_title calls when launcher-side handling is disabled', async () => {
        let metadata: Metadata = { path: '/repo', host: 'test' }
        const sessionClient = {
            getMetadata: () => metadata,
            flushMetadata: async () => true,
            updateMetadata: (handler: (value: Metadata) => Metadata) => { metadata = handler(metadata) },
            sendAgentMessage: vi.fn()
        } as unknown as ApiSessionClient
        const server = await startHappyServer(sessionClient, { emitTitleSummary: false })
        stopServer = server.stop
        const mcp = new Client({ name: 'codex-platform-functions', version: '1.0.0' })
        client = mcp
        await mcp.connect(new StreamableHTTPClientTransport(new URL(server.url)))

        const result = await mcp.callTool({ name: 'change_title', arguments: { title: 'Useful title', pin: true } }) as ToolResult
        expect(result.isError).toBe(false)
        expect(metadata).toMatchObject({ name: 'Useful title', nameLock: 'agent' })
    })

    it('leaves stdio-bridge title persistence to the parent launcher', async () => {
        const updateMetadata = vi.fn()
        const sessionClient = {
            updateMetadata,
            getMetadata: () => null,
            sendAgentMessage: vi.fn(),
            sendClaudeSessionMessage: vi.fn()
        } as unknown as ApiSessionClient
        const server = await startHappyServer(sessionClient, { emitTitleSummary: false })
        stopServer = server.stop
        const mcp = new Client({ name: 'hapi-stdio-bridge', version: '1.0.0' })
        client = mcp
        await mcp.connect(new StreamableHTTPClientTransport(new URL(server.url)))
        const callsAfterServerSetup = updateMetadata.mock.calls.length

        await mcp.callTool({ name: 'change_title', arguments: { title: 'Child title' } })

        expect(updateMetadata).toHaveBeenCalledTimes(callsAfterServerSetup)
    })

})

describe('startHappyServer change_title', () => {
    let stopServer: (() => void) | null
    let client: Client | null

    afterEach(async () => {
        await client?.close()
        stopServer?.()
        client = null
        stopServer = null
    })

    async function connectChangeTitleServer(sessionClient: ApiSessionClient, options?: Parameters<typeof startHappyServer>[1]) {
        const server = await startHappyServer(sessionClient, options)
        stopServer = server.stop
        client = new Client(
            { name: 'hapi-change-title-test', version: '1.0.0' },
            { capabilities: {} }
        )
        await client.connect(new StreamableHTTPClientTransport(new URL(server.url)))
        return client
    }

    it('renames via metadata.name so spawn --name sessions update visibly', async () => {
        let metadata: Metadata = { path: '/tmp', host: 'localhost', name: 'issue-triage-#54', summary: { text: 'stale', updatedAt: 1 } }
        const sessionClient = {
            getMetadata: () => metadata,
            flushMetadata: async () => true,
            updateMetadata: (handler: (value: Metadata) => Metadata) => { metadata = handler(metadata) },
            sendAgentMessage: vi.fn()
        } as unknown as ApiSessionClient
        const mcp = await connectChangeTitleServer(sessionClient)
        const result = await mcp.callTool({ name: 'change_title', arguments: { title: '  Renamed triage peer  ' } }) as ToolResult
        expect(result.isError).toBe(false)
        expect(result.content?.[0]?.text).toContain('Successfully changed chat title to: "Renamed triage peer"')
        expect(metadata).toMatchObject({ name: 'Renamed triage peer', summary: { text: 'stale' } })
        expect(metadata.nameLock).toBeUndefined()
    })

    it('pins through MCP and preserves the title after reconnect and later ordinary renames', async () => {
        let metadata: Metadata = { path: '/repo', host: 'test', name: 'Task' }
        const sessionClient = {
            getMetadata: () => metadata,
            flushMetadata: async () => true,
            updateMetadata: (handler: (value: Metadata) => Metadata) => { metadata = handler(metadata) },
            sendAgentMessage: vi.fn()
        } as unknown as ApiSessionClient
        const mcp = await connectChangeTitleServer(sessionClient)
        const pin = await mcp.callTool({ name: 'change_title', arguments: { title: ' Координатор ', pin: true } }) as ToolResult
        expect(pin.isError).toBe(false)
        expect(metadata).toMatchObject({ name: 'Координатор', nameLock: 'agent' })

        // Recreate the MCP server from persisted session metadata.
        metadata = JSON.parse(JSON.stringify(metadata))
        await client!.close()
        stopServer!()
        const resumed = await connectChangeTitleServer(sessionClient)
        const repeat = await resumed.callTool({ name: 'change_title', arguments: { title: 'Координатор', pin: true } }) as ToolResult
        expect(repeat.isError).toBe(false)
        for (const args of [{ title: 'New task' }, { title: 'New task', pin: false }, { title: 'Интегратор', pin: true }]) {
            const rejected = await resumed.callTool({ name: 'change_title', arguments: args }) as ToolResult
            expect(rejected.isError).toBe(true)
            expect(rejected.content?.[0]?.text).toContain('protected')
            expect(metadata).toMatchObject({ name: 'Координатор', nameLock: 'agent' })
        }
    })

    it('returns an error for blank titles instead of claiming success', async () => {
        const updateMetadata = vi.fn()
        const sessionClient = {
            updateMetadata,
            sendAgentMessage: vi.fn(),
            sendClaudeSessionMessage: vi.fn()
        } as unknown as ApiSessionClient

        const mcp = await connectChangeTitleServer(sessionClient)
        updateMetadata.mockClear()

        const result = await mcp.callTool({
            name: 'change_title',
            arguments: { title: '   ' }
        }) as ToolResult

        expect(result.isError).toBe(true)
        expect(result.content?.[0]?.text).toContain('Failed to change chat title')
        expect(updateMetadata).not.toHaveBeenCalled()
    })

})
describe('toClaudeAllowedHapiMcpTools', () => {
    it('keeps local-path and peer tools registered but out of Claude --allowedTools', () => {
        expect(toClaudeAllowedHapiMcpTools([
            'change_title',
            'display_image',
            'display_video',
            'display_media',
            'list_peers',
            'ping_peer',
            'inspect_peer',
            'list_launch_options',
            'launch_agent',
            'create_group',
            'skill_lookup'
        ])).toEqual([
            'mcp__hapi__change_title',
            'mcp__hapi__display_image',
            'mcp__hapi__list_peers',
            'mcp__hapi__list_launch_options',
            'mcp__hapi__skill_lookup'
        ])
        expect(toClaudeAllowedHapiMcpTools(['display_video'])).not.toContain('mcp__hapi__display_video')
        expect(toClaudeAllowedHapiMcpTools(['display_media'])).not.toContain('mcp__hapi__display_media')
    })
})


describe('startHappyServer close_session', () => {
    it.each([['native-client', true, 1], ['hapi-stdio-bridge', false, 0]] as const)(
        'binds closure to this client and defers shared Codex receipts (%s)', async (name, emitTitleSummary, calls) => {
            const requestCloseAfterTurn = vi.fn(async () => {})
            const session = { sessionId: 'self', updateMetadata: vi.fn(), requestCloseAfterTurn } as unknown as ApiSessionClient
            const server = await startHappyServer(session, { emitTitleSummary })
            const mcp = new Client({ name, version: '1.0.0' })
            try {
                await mcp.connect(new StreamableHTTPClientTransport(new URL(server.url)))
                const rejected = await mcp.callTool({ name: 'close_session', arguments: { sessionId: 'peer' } }) as ToolResult
                expect(rejected.isError).toBe(true)
                const result = await mcp.callTool({ name: 'close_session', arguments: {} }) as ToolResult
                expect(result.isError).toBe(false)
                expect(requestCloseAfterTurn).toHaveBeenCalledTimes(calls)
            } finally {
                await mcp.close()
                server.stop()
            }
        }
    )
})
