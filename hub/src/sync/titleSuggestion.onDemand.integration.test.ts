import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { RpcRegistry } from '../socket/rpcRegistry'
import { Store } from '../store'
import { SyncEngine } from './syncEngine'

const originalFetch = globalThis.fetch
const providerEnvironment = {
    HAPI_TITLE_PROVIDER_BASE_URL: 'https://provider.example/v1',
    HAPI_TITLE_PROVIDER_API_KEY: 'test-key',
    HAPI_TITLE_PROVIDER_MODEL: 'small-model'
}
let savedEnvironment: Array<[string, string | undefined]>

beforeEach(() => {
    savedEnvironment = Object.keys(providerEnvironment).map(key => [key, process.env[key]])
    Object.assign(process.env, providerEnvironment)
})

afterEach(() => {
    globalThis.fetch = originalFetch
    for (const [key, value] of savedEnvironment) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
    }
})

describe('on-demand Hub title generation', () => {
    it.each(['thinking', 'ready', 'completed'] as const)(
        'calls the configured provider only on request across the %s boundary',
        async (boundary) => {
            const requests: Request[] = []
            globalThis.fetch = (async (input, init) => {
                requests.push(new Request(String(input), init))
                return Response.json({ choices: [{ message: { content: 'Deployment workflow' } }] })
            }) as typeof fetch
            const store = new Store(':memory:')
            const engine = new SyncEngine(
                store,
                { of: () => ({ to: () => ({ emit() {} }) }) } as never,
                new RpcRegistry(),
                { broadcast() {} } as never
            )
            try {
                const session = engine.getOrCreateSession(
                    `on-demand-title-${boundary}`,
                    { path: '/workspace/project', host: 'test' },
                    null,
                    'tenant'
                )
                const now = Date.now()
                store.messages.addMessage(session.id, {
                    role: 'user', content: { type: 'text', text: 'Explain deployment' }
                })
                engine.handleSessionAlive({ sid: session.id, time: now, thinking: true })
                store.messages.addMessage(session.id, {
                    role: 'assistant', content: { type: 'text', text: 'Deploy with a rollback plan.' }
                })
                if (boundary === 'thinking') {
                    engine.handleSessionAlive({ sid: session.id, time: now + 1, thinking: false })
                } else if (boundary === 'ready') {
                    const ready = store.messages.addMessage(session.id, {
                        role: 'agent', content: { type: 'event', data: { type: 'ready' } }
                    })
                    engine.handleRealtimeEvent({ type: 'message-received', sessionId: session.id, message: ready })
                } else {
                    engine.handleSessionEnd({ sid: session.id, time: now + 1, reason: 'completed' })
                }
                await new Promise(resolve => setTimeout(resolve, 0))

                expect(requests).toHaveLength(0)
                expect(engine.getSession(session.id)?.metadata?.summary).toBeUndefined()
                await expect(engine.suggestSessionTitle(session.id)).resolves.toBe('Deployment workflow')
                expect(requests).toHaveLength(1)
                expect(requests[0]?.url).toBe('https://provider.example/v1/chat/completions')
                expect(engine.getSession(session.id)?.metadata?.summary).toBeUndefined()
            } finally {
                engine.stop()
                store.close()
            }
        }
    )
})
