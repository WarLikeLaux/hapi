import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { PropsWithChildren } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { ApiClient } from '@/api/client'
import { queryKeys } from '@/lib/query-keys'
import { useExternalMessages } from './useExternalMessages'

describe('useExternalMessages', () => {
    it('marks a conversation read on mount even when its prefetched snapshot is fresh', async () => {
        const queryClient = new QueryClient({
            defaultOptions: { queries: { retry: false, staleTime: 5_000 } }
        })
        const cached = { messages: [], participants: [] }
        const refreshed = { messages: [], participants: [] }
        queryClient.setQueryData(queryKeys.externalMessages('telegram:user:1'), cached)
        const getExternalMessages = vi.fn().mockResolvedValue(refreshed)
        const api = { getExternalMessages } as unknown as ApiClient
        const wrapper = ({ children }: PropsWithChildren) => (
            <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        )

        const { result } = renderHook(
            () => useExternalMessages(api, 'telegram:user:1'),
            { wrapper }
        )

        expect(result.current.data).toBe(cached)
        await waitFor(() => expect(getExternalMessages).toHaveBeenCalledTimes(1))
        expect(getExternalMessages).toHaveBeenCalledWith('telegram:user:1')
    })
})
