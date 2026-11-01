import { useCallback, useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { ExternalConversation } from '@hapi/protocol/messengers'
import type { ApiClient } from '@/api/client'
import { queryKeys } from '@/lib/query-keys'

export function getExternalConversationMessageVersion(conversation: ExternalConversation): string {
    return `${conversation.lastMessageAt ?? 'none'}\0${conversation.lastMessagePreview ?? ''}\0${conversation.unreadCount}`
}

/** Combine nearby SSE updates without postponing refresh indefinitely during a stream. */
export function useExternalConversationInvalidation(): (includeCandidates?: boolean) => void {
    const queryClient = useQueryClient()
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
    const candidates = useRef(false)

    useEffect(() => () => {
        if (timer.current !== null) clearTimeout(timer.current)
    }, [])

    return useCallback((includeCandidates = false) => {
        candidates.current ||= includeCandidates
        if (timer.current !== null) return
        timer.current = setTimeout(() => {
            timer.current = null
            void queryClient.invalidateQueries({ queryKey: queryKeys.externalConversations })
            if (candidates.current) {
                candidates.current = false
                void queryClient.invalidateQueries({ queryKey: ['messenger-candidates'] })
            }
        }, 50)
    }, [queryClient])
}

export function useExternalMessagePrefetch(
    api: ApiClient | null,
    conversations: ExternalConversation[] | undefined
): void {
    const queryClient = useQueryClient()
    const prefetchedVersionsRef = useRef(new Map<string, string>())

    useEffect(() => {
        if (!api || !conversations) return
        const liveIds = new Set(conversations.map((conversation) => conversation.id))
        for (const id of prefetchedVersionsRef.current.keys()) {
            if (!liveIds.has(id)) prefetchedVersionsRef.current.delete(id)
        }

        for (const conversation of conversations) {
            const version = getExternalConversationMessageVersion(conversation)
            if (prefetchedVersionsRef.current.get(conversation.id) === version) continue
            prefetchedVersionsRef.current.set(conversation.id, version)
            void queryClient.prefetchQuery({
                queryKey: queryKeys.externalMessages(conversation.id),
                queryFn: async () => await api.getExternalMessages(conversation.id, {
                    markRead: false,
                    refresh: false
                })
            }).catch(() => {
                if (prefetchedVersionsRef.current.get(conversation.id) === version) {
                    prefetchedVersionsRef.current.delete(conversation.id)
                }
            })
        }
    }, [api, conversations, queryClient])
}

export function useExternalMessageEventPrefetch(api: ApiClient | null): (conversationId: string) => void {
    const queryClient = useQueryClient()
    const timersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>())

    useEffect(() => () => {
        for (const timer of timersRef.current.values()) clearTimeout(timer)
        timersRef.current.clear()
    }, [])

    return useCallback((conversationId: string) => {
        if (!api) return
        const existing = timersRef.current.get(conversationId)
        if (existing) clearTimeout(existing)
        timersRef.current.set(conversationId, setTimeout(() => {
            timersRef.current.delete(conversationId)
            const queryKey = queryKeys.externalMessages(conversationId)
            const activeQuery = queryClient.getQueryCache().find({ queryKey, exact: true })
            if ((activeQuery?.getObserversCount() ?? 0) > 0) return
            void queryClient.prefetchQuery({
                queryKey,
                queryFn: async () => await api.getExternalMessages(conversationId, {
                    markRead: false,
                    refresh: false
                })
            })
        }, 50))
    }, [api, queryClient])
}
