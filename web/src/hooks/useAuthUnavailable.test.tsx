import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAuth } from './useAuth'

const source = { type: 'accessToken' as const, token: 'saved-token' }

afterEach(() => vi.unstubAllGlobals())

describe('authentication during an outage', () => {
    it('retries a 502 with the same token and recovers', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(new Response('<html>bad gateway</html>', { status: 502 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({ token: 'jwt', user: { id: '1' } }), { status: 200 }))
        vi.stubGlobal('fetch', fetchMock)
        const { result } = renderHook(() => useAuth(source, 'http://hub.test'))
        await waitFor(() => expect(result.current.unavailable).toBe(true))
        expect(result.current.error).toBeNull()
        act(() => result.current.retry())
        await waitFor(() => expect(result.current.token).toBe('jwt'))
        expect(result.current.unavailable).toBe(false)
        expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ accessToken: 'saved-token' })
    })

    it('reconnects automatically after a network failure', async () => {
        const fetchMock = vi.fn()
            .mockRejectedValueOnce(new TypeError('network unavailable'))
            .mockResolvedValueOnce(new Response(JSON.stringify({ token: 'jwt', user: { id: '1' } }), { status: 200 }))
        vi.stubGlobal('fetch', fetchMock)
        const { result } = renderHook(() => useAuth(source, 'http://hub.test'))
        await waitFor(() => expect(result.current.unavailable).toBe(true))
        await waitFor(() => expect(result.current.token).toBe('jwt'), { timeout: 7000 })
        expect(result.current.unavailable).toBe(false)
    }, 8000)

    it('reports a real authorization failure instead of retrying as an outage', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('invalid token', { status: 401 })))
        const { result } = renderHook(() => useAuth(source, 'http://hub.test'))
        await waitFor(() => expect(result.current.error).toContain('401'))
        expect(result.current.unavailable).toBe(false)
    })
})
