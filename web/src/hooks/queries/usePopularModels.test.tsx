import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import type { ApiClient } from '@/api/client'
import { usePopularModels } from './usePopularModels'

it('keeps the first weekly ranking stable while the shared query is refreshed', async () => {
    const first = { range: { from: 0, to: 1 }, models: [{ agent: 'cursor', model: 'composer-2.5', sessionCount: 4, lastUsedAt: 1 }] }
    const next = { range: { from: 1, to: 2 }, models: [{ agent: 'codex', model: 'gpt-6.1-sol', sessionCount: 5, lastUsedAt: 2 }] }
    const getPopularModels = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(next)
    const api = { getPopularModels } as unknown as ApiClient
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
    const view = renderHook(() => usePopularModels(api), { wrapper })
    await waitFor(() => expect(view.result.current.models).toEqual(first.models))
    await act(async () => { await client.invalidateQueries({ queryKey: ['popular-models'] }) })
    expect(getPopularModels).toHaveBeenCalledTimes(2)
    expect(client.getQueryData(['popular-models'])).toEqual(next)
    expect(view.result.current.models).toEqual(first.models)
    view.unmount()
    getPopularModels.mockResolvedValueOnce(first)
    const reopened = renderHook(() => usePopularModels(api), { wrapper })
    await waitFor(() => expect(reopened.result.current.models).toEqual(first.models))
    expect(getPopularModels).toHaveBeenCalledTimes(3)
    reopened.unmount()
    client.clear()
})


it('finishes loading with quick-pick fallback when weekly history cannot be read', async () => {
    const api = { getPopularModels: vi.fn().mockRejectedValue(new Error('Unavailable')) } as unknown as ApiClient
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
    const view = renderHook(() => usePopularModels(api), { wrapper })
    await waitFor(() => expect(view.result.current.isLoading).toBe(false))
    expect(view.result.current.models).toEqual([])
    view.unmount()
    client.clear()
})
