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
vi.mock('@/api/auth', () => ({ getAuthToken: () => 'test-cli:default' }))
vi.mock('@/ui/tokenInit', () => ({ initializeToken: vi.fn(async () => {}) }))

import { startHappyServer, toClaudeAllowedHapiMcpTools } from '@/claude/utils/startHappyServer'
import { handleGetCommand } from './get'
import { initializeToken } from '@/ui/tokenInit'

const summary = {
    range: { from: null, to: 1800000000000 },
    totals: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 80, cacheCreationTokens: 0, totalTokens: 120, uncachedTokens: 40, requests: 2, sessions: 1 },
    daily: [{ key: '2027-01-15', inputTokens: 100, outputTokens: 20, cacheReadTokens: 80, cacheCreationTokens: 0, totalTokens: 120, uncachedTokens: 40, requests: 2 }],
    byAgent: [{ key: 'codex', inputTokens: 100, outputTokens: 20, cacheReadTokens: 80, cacheCreationTokens: 0, totalTokens: 120, uncachedTokens: 40, requests: 2 }],
    byModel: [], updatedAt: 1800000000000,
}

describe('hapi get usage and MCP get_usage', () => {
    let hub: Server
    let paths: string[]
    let denied: boolean
    let stdout: ReturnType<typeof vi.spyOn>

    beforeEach(async () => {
        paths = []
        denied = false
        stdout = vi.spyOn(console, 'log').mockImplementation(() => {})
        vi.mocked(initializeToken).mockClear()
        hub = createServer(async (req, res) => {
            let raw = ''
            for await (const chunk of req) raw += chunk
            const reply = (body: unknown, status = 200) => {
                res.writeHead(status, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify(body))
            }
            if (req.url === '/api/auth') {
                if (JSON.parse(raw).accessToken !== 'test-cli:default') return reply({ error: 'bad credentials' }, 401)
                return reply({ token: 'usage-jwt' })
            }
            if (req.headers.authorization !== 'Bearer usage-jwt') return reply({ error: 'unauthorized' }, 401)
            paths.push(req.url!)
            if (req.url === '/api/sessions') return reply({ sessions: [{ id: 'session-one', active: false }, { id: 'session-two', active: true }] })
            if (req.url?.startsWith('/api/usage/summary?')) {
                if (denied) return reply({ error: 'Usage summary is only available to the hub owner' }, 403)
                return reply(summary)
            }
            return reply({ error: 'Unexpected request' }, 404)
        })
        await new Promise<void>(resolve => hub.listen(0, '127.0.0.1', resolve))
        config.apiUrl = `http://127.0.0.1:${(hub.address() as AddressInfo).port}`
    })

    afterEach(async () => {
        stdout.mockRestore()
        hub.closeAllConnections()
        await new Promise<void>(resolve => hub.close(() => resolve()))
    })

    it('prints only machine-readable collected usage and filters an inactive session without resuming it', async () => {
        await handleGetCommand(['usage', '--range=all', '--session', 'session-o', '--time-zone=Asia/Omsk', '--json'])
        expect(stdout).toHaveBeenCalledTimes(1)
        expect(JSON.parse(stdout.mock.calls[0]![0] as string)).toEqual({ ...summary, sessionId: 'session-one' })
        expect(paths).toEqual(['/api/sessions', '/api/usage/summary?range=all&timeZone=Asia%2FOmsk&sessionId=session-one'])
    })

    it('uses the existing summary defaults and explains tokens, cache and missing data in text output', async () => {
        await handleGetCommand(['usage'])
        expect(paths).toEqual(['/api/usage/summary?range=7d&timeZone=UTC'])
        const output = stdout.mock.calls[0]![0] as string
        expect(output).toContain('120 total; 100 input; 20 output')
        expect(output).toContain('80 read; 0 created (included in input)')
        expect(output).toContain('not subscription quota')
        expect(output).toContain('missing usage is not estimated')
        expect(output).toContain('Agent codex: 120 tokens')
    })

    it.each([
        ['usage', '--range', 'year'], ['usage', '--session'], ['usage', '--session='],
        ['usage', '--time-zone', 'Mars/Olympus'], ['usage', '--range', '--json'],
        ['usage', '--unknown'], ['usage', 'extra'], ['quota'],
    ])('rejects invalid arguments %j before authentication', async (...args) => {
        await expect(handleGetCommand(args)).rejects.toThrow()
        expect(initializeToken).not.toHaveBeenCalled()
        expect(stdout).not.toHaveBeenCalled()
        expect(paths).toEqual([])
    })

    it('rejects ambiguous and unknown session prefixes without requesting a summary', async () => {
        for (const [prefix, error] of [['session-', 'matches 2 sessions'], ['missing', 'no session matching']]) {
            await expect(handleGetCommand(['usage', '--session', prefix!, '--json'])).rejects.toThrow(error)
        }
        expect(paths).toEqual(['/api/sessions', '/api/sessions'])
        expect(stdout).not.toHaveBeenCalled()
    })

    it('exposes the same JSON through HTTP MCP and propagates owner-only denial on both entry points', async () => {
        const server = await startHappyServer({ sessionId: 'caller', updateMetadata: vi.fn() } as unknown as ApiSessionClient)
        const client = new Client({ name: 'usage-test', version: '1' })
        try {
            expect(server.toolNames).toContain('get_usage')
            expect(toClaudeAllowedHapiMcpTools(server.toolNames)).not.toContain('mcp__hapi__get_usage')
            await client.connect(new StreamableHTTPClientTransport(new URL(server.url)))
            const result = await client.callTool({ name: 'get_usage', arguments: { range: 'all', sessionIdPrefix: 'session-o', timeZone: 'Asia/Omsk' } })
            expect(result.isError).toBe(false)
            expect(JSON.parse((result.content as Array<{ text: string }>)[0]!.text)).toEqual({ ...summary, sessionId: 'session-one' })
            denied = true
            const rejected = await client.callTool({ name: 'get_usage', arguments: {} })
            expect(rejected.isError).toBe(true)
            expect(JSON.stringify(rejected.content)).toContain('only available to the hub owner')
            await expect(handleGetCommand(['usage', '--json'])).rejects.toThrow('only available to the hub owner')
            expect(stdout).not.toHaveBeenCalled()
        } finally { await client.close(); server.stop() }
    })
})
