import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
    PingPeerError,
    extractInspectMessageSnippet,
    formatInspectPeerReport,
    inspectPeer,
    type PingPeerSessionSummary
} from './pingPeer'

type MockResponse = {
    status: number
    data: unknown
}

function createHttpMock(handlers: {
    post?: (url: string, body?: unknown) => MockResponse | Promise<MockResponse>
    get?: (url: string, config?: { params?: Record<string, unknown> }) => MockResponse | Promise<MockResponse>
}) {
    return {
        post: vi.fn(async (url: string, body?: unknown) => {
            if (!handlers.post) {
                throw new Error(`unexpected POST ${url}`)
            }
            return handlers.post(url, body)
        }),
        get: vi.fn(async (url: string, config?: { params?: Record<string, unknown> }) => {
            if (!handlers.get) {
                throw new Error(`unexpected GET ${url}`)
            }
            return handlers.get(url, config)
        })
    }
}

describe('inspectPeer', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('loads metadata and recent messages without calling resume', async () => {
        const sessionId = '7d55ed21-8a9f-4309-b4f8-30069df36b4b'
        const http = createHttpMock({
            post: (url) => {
                if (url.endsWith('/api/auth')) {
                    return { status: 200, data: { token: 'jwt' } }
                }
                throw new Error(`unexpected POST ${url}`)
            },
            get: (url, config) => {
                if (url.endsWith('/api/sessions')) {
                    return {
                        status: 200,
                        data: {
                            sessions: [{
                                id: sessionId,
                                active: false,
                                updatedAt: 1_700_000_000_000,
                                metadata: {
                                    name: 'hub runner version governance',
                                    flavor: 'cursor',
                                    path: '/home/heavygee/coding/hapi'
                                }
                            } satisfies PingPeerSessionSummary]
                        }
                    }
                }
                if (url.endsWith(`/api/sessions/${sessionId}`)) {
                    return {
                        status: 200,
                        data: {
                            session: {
                                id: sessionId,
                                active: false,
                                thinking: false,
                                updatedAt: 1_700_000_000_000,
                                metadata: {
                                    name: 'hub runner version governance',
                                    flavor: 'cursor',
                                    path: '/home/heavygee/coding/hapi',
                                    lifecycleState: 'archived'
                                }
                            }
                        }
                    }
                }
                if (url.endsWith(`/api/sessions/${sessionId}/messages`)) {
                    expect(config?.params).toEqual({ limit: 200 })
                    return {
                        status: 200,
                        data: {
                            messages: [
                                {
                                    id: 'm1',
                                    createdAt: 1_700_000_000_100,
                                    content: {
                                        role: 'user',
                                        content: { text: 'status on runner versions?' }
                                    }
                                },
                                {
                                    id: 'm2',
                                    createdAt: 1_700_000_000_200,
                                    content: {
                                        role: 'agent',
                                        content: {
                                            type: 'codex',
                                            data: {
                                                type: 'message',
                                                message: 'Looking into it.'
                                            }
                                        }
                                    }
                                }
                            ],
                            page: { nextBeforeAt: null, nextBeforeSeq: null }
                        }
                    }
                }
                throw new Error(`unexpected GET ${url}`)
            }
        })

        const result = await inspectPeer({
            sessionIdPrefix: sessionId,
            accessToken: 'tok',
            apiUrl: 'http://hub.test',
            http: http as never
        })

        expect(result.sessionId).toBe(sessionId)
        expect(result.name).toBe('hub runner version governance')
        expect(result.active).toBe(false)
        expect(result.flavor).toBe('cursor')
        expect(result.path).toBe('/home/heavygee/coding/hapi')
        expect(result.messages).toHaveLength(2)
        expect(result.messages[0]).toMatchObject({
            role: 'user',
            text: 'status on runner versions?'
        })
        expect(result.messages[1]?.text).toContain('Looking into it.')
        expect(result.olderBeforeAt).toBeNull()
        expect(result.olderBeforeSeq).toBeNull()

        // Read-only: never resume
        expect(http.post).toHaveBeenCalledTimes(1)
        expect(http.post.mock.calls[0]![0]).toContain('/api/auth')
        expect(http.post.mock.calls.some((call) => String(call[0]).includes('/resume'))).toBe(false)
    })

    it('respects messageLimit and refuses empty prefix', async () => {
        await expect(inspectPeer({
            sessionIdPrefix: '  ',
            accessToken: 'tok',
            apiUrl: 'http://hub.test',
            http: createHttpMock({}) as never
        })).rejects.toMatchObject({ code: 'bad_args' } satisfies Partial<PingPeerError>)

        const sessionId = 'aaaaaaaa-1111-1111-1111-111111111111'
        const http = createHttpMock({
            post: (url) => {
                if (url.endsWith('/api/auth')) {
                    return { status: 200, data: { token: 'jwt' } }
                }
                throw new Error(`unexpected POST ${url}`)
            },
            get: (url, config) => {
                if (url.endsWith('/api/sessions')) {
                    return {
                        status: 200,
                        data: { sessions: [{ id: sessionId, active: true, metadata: { name: 'A' } }] }
                    }
                }
                if (url.endsWith(`/api/sessions/${sessionId}`)) {
                    return {
                        status: 200,
                        data: { session: { id: sessionId, active: true, metadata: { name: 'A' } } }
                    }
                }
                if (url.endsWith(`/api/sessions/${sessionId}/messages`)) {
                    expect(config?.params).toEqual({ limit: 200 })
                    return { status: 200, data: { messages: [], page: {} } }
                }
                throw new Error(`unexpected GET ${url}`)
            }
        })

        await inspectPeer({
            sessionIdPrefix: 'aaaaaaaa',
            messageLimit: 5,
            accessToken: 'tok',
            apiUrl: 'http://hub.test',
            http: http as never
        })
    })

    it('clamps messageLimit to 1..200 and always requests hub pages of 200', async () => {
        const sessionId = 'bbbbbbbb-3333-3333-3333-333333333333'
        const http = createHttpMock({
            post: (url) => {
                if (url.endsWith('/api/auth')) {
                    return { status: 200, data: { token: 'jwt' } }
                }
                throw new Error(`unexpected POST ${url}`)
            },
            get: (url, config) => {
                if (url.endsWith('/api/sessions')) {
                    return {
                        status: 200,
                        data: { sessions: [{ id: sessionId, active: true, metadata: { name: 'C' } }] }
                    }
                }
                if (url.endsWith(`/api/sessions/${sessionId}`)) {
                    return {
                        status: 200,
                        data: { session: { id: sessionId, active: true, metadata: { name: 'C' } } }
                    }
                }
                if (url.endsWith(`/api/sessions/${sessionId}/messages`)) {
                    expect(config?.params).toEqual({ limit: 200 })
                    return { status: 200, data: { messages: [], page: {} } }
                }
                throw new Error(`unexpected GET ${url}`)
            }
        })

        await inspectPeer({
            sessionIdPrefix: sessionId,
            messageLimit: 999,
            accessToken: 'tok',
            apiUrl: 'http://hub.test',
            http: http as never
        })
    })

    it('rejects a beforeAt/beforeSeq cursor with only one half', async () => {
        await expect(inspectPeer({
            sessionIdPrefix: 'cccccccc',
            beforeAt: 123,
            accessToken: 'tok',
            apiUrl: 'http://hub.test',
            http: createHttpMock({}) as never
        })).rejects.toMatchObject({ code: 'bad_args' } satisfies Partial<PingPeerError>)

        await expect(inspectPeer({
            sessionIdPrefix: 'cccccccc',
            beforeSeq: 45,
            accessToken: 'tok',
            apiUrl: 'http://hub.test',
            http: createHttpMock({}) as never
        })).rejects.toMatchObject({ code: 'bad_args' } satisfies Partial<PingPeerError>)
    })

    it('keeps paging hub pages until messageLimit text messages are collected', async () => {
        const sessionId = 'dddddddd-4444-4444-4444-444444444444'
        const calls: Array<Record<string, unknown> | undefined> = []
        const noiseRow = (id: string, createdAt: number, seq: number) => ({
            id,
            createdAt,
            seq,
            content: {
                role: 'agent',
                content: { type: 'codex', data: { type: 'token_count', total: 100 } }
            }
        })
        const textRow = (id: string, createdAt: number, seq: number, text: string) => ({
            id,
            createdAt,
            seq,
            content: { role: 'user', content: { text } }
        })
        const http = createHttpMock({
            post: async () => ({ status: 200, data: { token: 'jwt' } }),
            get: (url, config) => {
                if (url.endsWith('/api/sessions')) {
                    return {
                        status: 200,
                        data: { sessions: [{ id: sessionId, active: true, metadata: { name: 'D' } }] }
                    }
                }
                if (url.endsWith(`/api/sessions/${sessionId}`)) {
                    return {
                        status: 200,
                        data: { session: { id: sessionId, active: true, metadata: { name: 'D' } } }
                    }
                }
                if (url.endsWith(`/api/sessions/${sessionId}/messages`)) {
                    calls.push(config?.params)
                    if (calls.length === 1) {
                        return {
                            status: 200,
                            data: {
                                messages: [
                                    textRow('t1', 300, 30, 'newest text'),
                                    noiseRow('n1', 200, 29),
                                    textRow('t2', 100, 28, 'second text')
                                ],
                                page: { nextBeforeAt: 50, nextBeforeSeq: 27 }
                            }
                        }
                    }
                    return {
                        status: 200,
                        data: {
                            messages: [
                                textRow('t3', 50, 27, 'third text')
                            ],
                            page: { nextBeforeAt: null, nextBeforeSeq: null }
                        }
                    }
                }
                throw new Error(`unexpected GET ${url}`)
            }
        })

        const result = await inspectPeer({
            sessionIdPrefix: sessionId,
            messageLimit: 3,
            accessToken: 'tok',
            apiUrl: 'http://hub.test',
            http: http as never
        })

        expect(calls[0]).toEqual({ limit: 200 })
        expect(calls[1]).toEqual({ limit: 200, beforeAt: 50, beforeSeq: 27 })
        expect(result.messages.map((m) => m.text)).toEqual(['newest text', 'second text', 'third text'])
        expect(result.olderBeforeAt).toBeNull()
        expect(result.olderBeforeSeq).toBeNull()
    })

    it('stops mid-page and reports the last consumed row as the older cursor', async () => {
        const sessionId = 'eeeeeeee-5555-5555-5555-555555555555'
        const noiseRow = (id: string, createdAt: number, seq: number) => ({
            id,
            createdAt,
            seq,
            content: {
                role: 'agent',
                content: { type: 'codex', data: { type: 'tool-call', name: 'Bash', callId: id } }
            }
        })
        const textRow = (id: string, createdAt: number, seq: number, text: string) => ({
            id,
            createdAt,
            seq,
            content: { role: 'agent', content: { type: 'codex', data: { type: 'message', message: text } } }
        })
        const http = createHttpMock({
            post: async () => ({ status: 200, data: { token: 'jwt' } }),
            get: async (url) => {
                if (url.endsWith('/api/sessions')) {
                    return {
                        status: 200,
                        data: { sessions: [{ id: sessionId, active: true, metadata: { name: 'E' } }] }
                    }
                }
                if (url.endsWith(`/api/sessions/${sessionId}`)) {
                    return {
                        status: 200,
                        data: { session: { id: sessionId, active: true, metadata: { name: 'E' } } }
                    }
                }
                if (url.endsWith(`/api/sessions/${sessionId}/messages`)) {
                    return {
                        status: 200,
                        data: {
                            messages: [
                                textRow('m10', 1000, 10, 'one'),
                                noiseRow('m9', 900, 9),
                                textRow('m8', 800, 8, 'two'),
                                textRow('m7', 700, 7, 'three'),
                                textRow('m6', 600, 6, 'four')
                            ],
                            page: { nextBeforeAt: 500, nextBeforeSeq: 5 }
                        }
                    }
                }
                throw new Error(`unexpected GET ${url}`)
            }
        })

        const result = await inspectPeer({
            sessionIdPrefix: sessionId,
            messageLimit: 3,
            accessToken: 'tok',
            apiUrl: 'http://hub.test',
            http: http as never
        })

        expect(result.messages.map((m) => m.text)).toEqual(['one', 'two', 'three'])
        // Cursor must sit on the last consumed raw row (seq 7), not on skipped
        // rows behind it or on the unread seq 6 row.
        expect(result.olderBeforeAt).toBe(700)
        expect(result.olderBeforeSeq).toBe(7)
    })

    it('passes the provided cursor to the first hub page request', async () => {
        const sessionId = 'ffffffff-6666-6666-6666-666666666666'
        let firstMessageParams: Record<string, unknown> | undefined
        const http = createHttpMock({
            post: async () => ({ status: 200, data: { token: 'jwt' } }),
            get: (url, config) => {
                if (url.endsWith('/api/sessions')) {
                    return {
                        status: 200,
                        data: { sessions: [{ id: sessionId, active: true, metadata: { name: 'F' } }] }
                    }
                }
                if (url.endsWith(`/api/sessions/${sessionId}`)) {
                    return {
                        status: 200,
                        data: { session: { id: sessionId, active: true, metadata: { name: 'F' } } }
                    }
                }
                if (url.endsWith(`/api/sessions/${sessionId}/messages`)) {
                    firstMessageParams = config?.params
                    return { status: 200, data: { messages: [], page: {} } }
                }
                throw new Error(`unexpected GET ${url}`)
            }
        })

        await inspectPeer({
            sessionIdPrefix: sessionId,
            beforeAt: 1791210000000,
            beforeSeq: 1234,
            accessToken: 'tok',
            apiUrl: 'http://hub.test',
            http: http as never
        })

        expect(firstMessageParams).toEqual({ limit: 200, beforeAt: 1791210000000, beforeSeq: 1234 })
    })

    it('accepts a pasted Copy-reference citation as sessionIdPrefix', async () => {
        const sessionId = '7ee03698-0fe7-4f76-b8a8-d84f4eddbf5c'
        const http = createHttpMock({
            post: async () => ({ status: 200, data: { token: 'jwt' } }),
            get: async (url) => {
                if (url.endsWith('/api/sessions')) {
                    return {
                        status: 200,
                        data: {
                            sessions: [
                                {
                                    id: sessionId,
                                    active: true,
                                    thinking: false,
                                    updatedAt: 1,
                                    metadata: { name: 'Coding', flavor: 'codex' }
                                }
                            ]
                        }
                    }
                }
                if (url.endsWith(`/api/sessions/${sessionId}`)) {
                    return {
                        status: 200,
                        data: {
                            session: {
                                id: sessionId,
                                active: true,
                                thinking: false,
                                updatedAt: 1,
                                metadata: { name: 'Coding', flavor: 'codex' }
                            }
                        }
                    }
                }
                if (url.endsWith(`/api/sessions/${sessionId}/messages`)) {
                    return {
                        status: 200,
                        data: { messages: [], page: { hasMore: false } }
                    }
                }
                throw new Error(`unexpected GET ${url}`)
            }
        })

        const result = await inspectPeer({
            sessionIdPrefix: `See session "Coding" (/sessions/${sessionId}) for context`,
            accessToken: 'tok',
            apiUrl: 'http://hub.test',
            http: http as never
        })

        expect(result.sessionId).toBe(sessionId)
        expect(result.name).toBe('Coding')
    })
})

describe('formatInspectPeerReport', () => {
    it('includes session id and message snippets for agent consumption', () => {
        const report = formatInspectPeerReport({
            sessionId: '7d55ed21-8a9f-4309-b4f8-30069df36b4b',
            name: 'hub runner version governance',
            active: true,
            thinking: false,
            flavor: 'cursor',
            path: '/tmp/x',
            lifecycleState: null,
            updatedAt: 1_700_000_000_000,
            messages: [
                { id: '1', role: 'user', text: 'hello', createdAt: 1 },
                { id: '2', role: 'agent', text: 'world', createdAt: 2 }
            ],
            olderBeforeAt: null,
            olderBeforeSeq: null
        })
        expect(report).toContain('7d55ed21-8a9f-4309-b4f8-30069df36b4b')
        expect(report).toContain('hub runner version governance')
        expect(report).toContain('[user] hello')
        expect(report).toContain('[agent] world')
        expect(report).toContain('/sessions/7d55ed21-8a9f-4309-b4f8-30069df36b4b')
        expect(report).toContain('older page: none')
    })

    it('prints the older-page cursor for follow-up calls', () => {
        const report = formatInspectPeerReport({
            sessionId: '7d55ed21-8a9f-4309-b4f8-30069df36b4b',
            name: 'x',
            active: false,
            thinking: false,
            flavor: null,
            path: null,
            lifecycleState: null,
            updatedAt: null,
            messages: [{ id: '1', role: 'user', text: 'hello', createdAt: 1 }],
            olderBeforeAt: 1791210000000,
            olderBeforeSeq: 1234
        })
        expect(report).toContain(
            'older page: available - call again with beforeAt=1791210000000, beforeSeq=1234'
        )
    })
})

describe('extractInspectMessageSnippet', () => {
    it('preserves internal newlines and trims the edges', () => {
        const snippet = extractInspectMessageSnippet({
            role: 'agent',
            content: { type: 'codex', data: { type: 'message', message: '  line one\n\nline two  \n' } }
        })
        expect(snippet?.text).toBe('line one\n\nline two')
    })

    it('caps text at 4000 chars with an ellipsis', () => {
        const snippet = extractInspectMessageSnippet({
            role: 'user',
            content: { text: 'x'.repeat(5_000) }
        })
        expect(snippet?.text).toHaveLength(4_001)
        expect(snippet?.text.endsWith('…')).toBe(true)
    })
})
