import { afterEach, describe, expect, it, vi } from 'vitest'
import { archivePeer, PingPeerError } from './pingPeer'

const sessionId = '7d55ed21-8a9f-4309-b4f8-30069df36b4b'

function createHttpMock(options: { thinking?: boolean; active?: boolean; lifecycleState?: string } = {}) {
    return {
        post: vi.fn(async (url: string) => {
            if (url.endsWith('/api/auth')) return { status: 200, data: { token: 'jwt' } }
            if (url.endsWith(`/api/sessions/${sessionId}/archive`)) return { status: 200, data: { ok: true } }
            throw new Error(`unexpected POST ${url}`)
        }),
        get: vi.fn(async (url: string) => {
            if (url.endsWith('/api/sessions')) {
                return { status: 200, data: { sessions: [{ id: sessionId, active: true }] } }
            }
            if (url.endsWith(`/api/sessions/${sessionId}`)) {
                return {
                    status: 200,
                    data: {
                        session: {
                            id: sessionId,
                            active: options.active ?? true,
                            thinking: options.thinking ?? false,
                            metadata: { lifecycleState: options.lifecycleState ?? 'running' }
                        }
                    }
                }
            }
            throw new Error(`unexpected GET ${url}`)
        })
    }
}

describe('archivePeer', () => {
    afterEach(() => vi.unstubAllEnvs())

    it('archives an idle peer by its full session id', async () => {
        const http = createHttpMock()
        await expect(archivePeer({ sessionId, apiUrl: 'http://hub', accessToken: 'secret', http: http as never }))
            .resolves.toEqual({ sessionId, alreadyArchived: false })
        expect(http.post).toHaveBeenCalledWith(
            `http://hub/api/sessions/${sessionId}/archive`,
            {},
            expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer jwt' }) })
        )
    })

    it('refuses a busy peer before sending an archive request', async () => {
        const http = createHttpMock({ thinking: true })
        await expect(archivePeer({ sessionId, apiUrl: 'http://hub', accessToken: 'secret', http: http as never }))
            .rejects.toMatchObject({ code: 'busy' } satisfies Partial<PingPeerError>)
        expect(http.post).toHaveBeenCalledTimes(1)
    })

    it('requires a full id and refuses to archive itself', async () => {
        await expect(archivePeer({ sessionId: sessionId.slice(0, 8) }))
            .rejects.toMatchObject({ code: 'bad_args' } satisfies Partial<PingPeerError>)
        vi.stubEnv('HAPI_SESSION_ID', sessionId)
        await expect(archivePeer({ sessionId }))
            .rejects.toMatchObject({ code: 'bad_args' } satisfies Partial<PingPeerError>)
    })

    it('treats an already archived peer as complete without another archive request', async () => {
        const http = createHttpMock({ active: false, lifecycleState: 'archived' })
        await expect(archivePeer({ sessionId, apiUrl: 'http://hub', accessToken: 'secret', http: http as never }))
            .resolves.toEqual({ sessionId, alreadyArchived: true })
        expect(http.post).toHaveBeenCalledTimes(1)
    })

    it('stops an active peer even when its metadata already says archived', async () => {
        const http = createHttpMock({ active: true, lifecycleState: 'archived' })
        await expect(archivePeer({ sessionId, apiUrl: 'http://hub', accessToken: 'secret', http: http as never }))
            .resolves.toEqual({ sessionId, alreadyArchived: false })
        expect(http.post).toHaveBeenCalledTimes(2)
    })
})
