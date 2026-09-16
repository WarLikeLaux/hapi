import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { PropsWithChildren } from 'react'
import type { ExternalConversation } from '@hapi/protocol/messengers'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ApiClient } from '@/api/client'
import { useExternalMessageEventPrefetch, useExternalMessagePrefetch } from './useExternalMessagePrefetch'

const conversation: ExternalConversation = {
    id: 'telegram:user:1',
    provider: 'telegram',
    remoteId: 'user:1',
    title: 'Friend',
    kind: 'direct',
    selected: true,
    lastMessageAt: 100,
    lastMessagePreview: 'First',
    unreadCount: 0,
    avatarDataUrl: null
}

describe('useExternalMessagePrefetch', () => {
    afterEach(() => vi.useRealTimers())

    it('refreshes only when a conversation message snapshot changes', async () => {
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
        const getExternalMessages = vi.fn().mockResolvedValue({ messages: [], participants: [] })
        const api = { getExternalMessages } as unknown as ApiClient
        const wrapper = ({ children }: PropsWithChildren) => (
            <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        )
        const { rerender } = renderHook(
            ({ conversations }) => useExternalMessagePrefetch(api, conversations),
            { wrapper, initialProps: { conversations: [conversation] } }
        )

        await waitFor(() => expect(getExternalMessages).toHaveBeenCalledTimes(1))
        expect(getExternalMessages).toHaveBeenLastCalledWith(conversation.id, {
            markRead: false,
            refresh: false
        })

        rerender({ conversations: [{ ...conversation }] })
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(getExternalMessages).toHaveBeenCalledTimes(1)

        rerender({ conversations: [{
            ...conversation,
            lastMessageAt: 200,
            lastMessagePreview: 'Newest',
            unreadCount: 3
        }] })
        await waitFor(() => expect(getExternalMessages).toHaveBeenCalledTimes(2))
    })

    it('coalesces incoming events and refreshes a closed chat in the background', async () => {
        vi.useFakeTimers()
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
        const getExternalMessages = vi.fn().mockResolvedValue({ messages: [], participants: [] })
        const api = { getExternalMessages } as unknown as ApiClient
        const wrapper = ({ children }: PropsWithChildren) => (
            <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        )
        const { result } = renderHook(() => useExternalMessageEventPrefetch(api), { wrapper })

        act(() => {
            result.current(conversation.id)
            result.current(conversation.id)
            result.current(conversation.id)
            vi.advanceTimersByTime(50)
        })
        await act(async () => await Promise.resolve())

        expect(getExternalMessages).toHaveBeenCalledTimes(1)
        expect(getExternalMessages).toHaveBeenCalledWith(conversation.id, {
            markRead: false,
            refresh: false
        })
    })
})
