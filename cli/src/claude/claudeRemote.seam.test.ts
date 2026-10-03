import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SDKMessage } from '@/claude/sdk/types'

const spawnMock = vi.fn()
const killProcessMock = vi.fn(async (child: any) => {
    child.killed = true
    child.stdout.end()
    child.emit('close', 0)
    return true
})

vi.mock('node:child_process', () => ({
    ...require('node:child_process'),
    spawn: spawnMock
}))

vi.mock('@/claude/utils/claudeCheckSession', () => ({
    claudeCheckSession: () => true
}))

vi.mock('@/modules/watcher/awaitFileExist', () => ({
    awaitFileExist: async () => true
}))

vi.mock('@/utils/process', () => ({
    isProcessAlive: () => false,
    isWindows: () => false,
    killProcess: async () => true,
    killProcessByChildProcess: killProcessMock
}))

vi.mock('@/utils/bunRuntime', () => ({
    withBunRuntimeEnv: (env: NodeJS.ProcessEnv) => env
}))

function createFakeChild() {
    const child = new EventEmitter() as EventEmitter & {
        stdin: PassThrough
        stdout: PassThrough
        stderr: PassThrough
        killed: boolean
    }

    child.stdin = new PassThrough()
    child.stdout = new PassThrough()
    child.stderr = new PassThrough()
    child.killed = false
    return child
}

afterEach(() => {
    vi.clearAllMocks()
    delete process.env.HAPI_CLAUDE_PATH
})

describe('claudeRemote/query real seam', () => {
    it.each(['accepted', 'stopped'] as const)('waits for a native UUID replay before acknowledging a steer (%s)', async outcome => {
        const child = createFakeChild()
        spawnMock.mockReturnValueOnce(child)
        process.env.HAPI_CLAUDE_PATH = 'claude'
        const { claudeRemote } = await import('./claudeRemote')
        const controller = new AbortController()
        const ready = vi.fn()
        const accepted = vi.fn()
        const failed = vi.fn()
        const received: SDKMessage[] = []
        let sender: import('./claudeRemote').ClaudeSteerSender | null = null
        const inputs: Array<{ type: string; uuid?: string; message?: { content: string } }> = []
        child.stdin.on('data', data => {
            for (const line of data.toString().trim().split('\n')) inputs.push(JSON.parse(line))
        })
        let fetches = 0
        const run = claudeRemote({
            sessionId: 'session-1', path: process.cwd(), hookSettingsPath: '/tmp/hook.json',
            allowedTools: [], signal: controller.signal,
            canCallTool: async () => ({ behavior: 'allow', updatedInput: {} }),
            nextMessage: async () => ++fetches === 1 ? { message: 'original', mode: { permissionMode: 'default' } } : null,
            onReady: ready, isAborted: () => false, onSessionFound: () => {}, onMessage: message => { received.push(message) },
            onSteerReady: value => { sender = value },
        })
        const result = { type: 'result', subtype: 'success', num_turns: 1, session_id: 's-1' }
        const emit = (value: object) => child.stdout.write(JSON.stringify(value) + '\n')
        await vi.waitFor(() => expect(sender).not.toBeNull())
        await vi.waitFor(() => expect(inputs.some(input => input.message?.content === 'original')).toBe(true))
        const original = inputs.find(input => input.message?.content === 'original')!
        emit(original)
        await sender!('steered', { onAccepted: accepted, onFailure: failed })
        const steer = inputs.find(input => input.message?.content === 'steered')!
        expect(steer.uuid).toBeTypeOf('string')
        expect(accepted).not.toHaveBeenCalled()
        emit(result)
        emit({ type: 'user', uuid: 'unrelated', message: { role: 'user', content: 'another prompt' } })
        await new Promise(resolve => setTimeout(resolve, 0))
        expect(ready).not.toHaveBeenCalled()
        expect(fetches).toBe(1)
        expect(received.some(message => message.uuid === original.uuid)).toBe(false)
        expect(received.some(message => message.uuid === 'unrelated')).toBe(true)
        if (outcome === 'accepted') {
            emit(steer)
            emit(result)
            await vi.waitFor(() => expect(accepted).toHaveBeenCalledOnce())
            await vi.waitFor(() => expect(fetches).toBe(2))
            child.stdout.end()
            child.emit('close', 0)
            await run
            expect(failed).not.toHaveBeenCalled()
            expect(ready).toHaveBeenCalledOnce()
            expect(received.some(message => message.uuid === steer.uuid)).toBe(false)
        } else {
            controller.abort()
            await run
            expect(accepted).not.toHaveBeenCalled()
            expect(failed).toHaveBeenCalledOnce()
            expect(fetches).toBe(1)
        }
        expect(sender).toBeNull()
    })

    it('propagates scheduled nextMessage failures through real query prompt plumbing', async () => {
        const child = createFakeChild()
        spawnMock.mockReturnValueOnce(child)
        process.env.HAPI_CLAUDE_PATH = 'claude'
        const { claudeRemote } = await import('./claudeRemote')

        const received: SDKMessage[] = []
        let nextCallCount = 0

        const runPromise = claudeRemote({
            sessionId: 'session-1',
            path: process.cwd(),
            mcpServers: {},
            claudeEnvVars: {},
            claudeArgs: [],
            allowedTools: [],
            hookSettingsPath: '/tmp/hook.json',
            canCallTool: async () => ({ behavior: 'allow', updatedInput: {} }),
            nextMessage: async () => {
                nextCallCount += 1
                if (nextCallCount === 1) {
                    return { message: 'A', mode: { permissionMode: 'default' } }
                }
                throw new Error('next message failed')
            },
            onReady: () => {},
            isAborted: () => false,
            onSessionFound: () => {},
            onMessage: (message) => {
                received.push(message)
            },
            onCompletionEvent: () => {},
            onSessionReset: () => {}
        })

        child.stdout.write(JSON.stringify({
            type: 'assistant',
            message: {
                role: 'assistant',
                content: [{ type: 'text', text: 'A_1' }]
            }
        }) + '\n')
        child.stdout.write(JSON.stringify({
            type: 'result',
            subtype: 'success',
            num_turns: 1,
            total_cost_usd: 0,
            duration_ms: 1,
            duration_api_ms: 1,
            is_error: false,
            session_id: 's-1'
        }) + '\n')

        await expect(runPromise).rejects.toThrow('next message failed')
        expect(received.map((message) => message.type)).toEqual(['assistant', 'result'])
    }, 15_000)

    it('reports the model resolved by the SDK init message', async () => {
        const child = createFakeChild()
        spawnMock.mockReturnValueOnce(child)
        process.env.HAPI_CLAUDE_PATH = 'claude'
        const { claudeRemote } = await import('./claudeRemote')

        const models: string[] = []
        let nextCallCount = 0

        const runPromise = claudeRemote({
            sessionId: 'session-1',
            path: process.cwd(),
            mcpServers: {},
            claudeEnvVars: {},
            claudeArgs: [],
            allowedTools: [],
            hookSettingsPath: '/tmp/hook.json',
            canCallTool: async () => ({ behavior: 'allow', updatedInput: {} }),
            nextMessage: async () => {
                nextCallCount += 1
                if (nextCallCount === 1) {
                    return { message: 'A', mode: { permissionMode: 'default' } }
                }
                throw new Error('next message failed')
            },
            onReady: () => {},
            isAborted: () => false,
            onSessionFound: () => {},
            onModelFound: (model) => {
                models.push(model)
            },
            onMessage: () => {},
            onCompletionEvent: () => {},
            onSessionReset: () => {}
        })

        child.stdout.write(JSON.stringify({
            type: 'system',
            subtype: 'init',
            session_id: 's-1',
            model: 'claude-opus-4-6'
        }) + '\n')
        child.stdout.write(JSON.stringify({
            type: 'result',
            subtype: 'success',
            num_turns: 1,
            total_cost_usd: 0,
            duration_ms: 1,
            duration_api_ms: 1,
            is_error: false,
            session_id: 's-1'
        }) + '\n')

        await expect(runPromise).rejects.toThrow('next message failed')
        expect(models).toEqual(['claude-opus-4-6'])
    }, 15_000)
})
