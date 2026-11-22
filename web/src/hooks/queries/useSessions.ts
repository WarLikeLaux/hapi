import { useCallback, useEffect } from 'react'
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { compareSessionSummaries, mergeReadState } from '@hapi/protocol'
import type { ApiClient } from '@/api/client'
import type { SessionsResponse } from '@/types/api'
import { queryKeys } from '@/lib/query-keys'
import { reconcileAttachedJobsFromCache } from './reconcileAttachedJobs'

export type UseSessionsOptions = {
    enabled?: boolean
    includeHistory?: boolean
}

async function fetchSessions(api: ApiClient, queryClient: QueryClient, signal: AbortSignal): Promise<SessionsResponse> {
    const includeHistory = queryClient.getQueryData<symbol>(queryKeys.sessionHistoryRequested)
    const response = await api.getSessions(includeHistory ? undefined : 'initial', signal)
    // SSE may have delivered newer input while this GET was in flight.
    // Retain its monotonic ordering clock, not deleted rows or stale data.
    const current = queryClient.getQueryData<SessionsResponse>(queryKeys.sessions)
    const cached = new Map(current?.sessions.map(s => [s.id, s]))
    const withClocks: SessionsResponse = {
        ...response,
        sessions: response.sessions.map(session => {
            const prior = cached.get(session.id)
            return { ...session,
                lastUserMessageAt: Math.max(prior?.lastUserMessageAt ?? 0, session.lastUserMessageAt ?? 0) || undefined,
                contentRevision: Math.max(prior?.contentRevision ?? 0, session.contentRevision ?? 0),
                readState: mergeReadState(prior?.readState, session.readState)
            }
        }).sort(compareSessionSummaries)
    }
    return reconcileAttachedJobsFromCache(withClocks, current)
}

export async function loadSessionHistory(api: ApiClient, client: QueryClient) {
    const current = client.getQueryData<SessionsResponse>(queryKeys.sessions)
    const requested = client.getQueryData<symbol>(queryKeys.sessionHistoryRequested)
    if (requested && current && !current.historyDeferred) return current.sessions

    if (!requested) {
        const request = Symbol()
        client.setQueryDefaults(queryKeys.sessionHistoryRequested, { gcTime: Infinity })
        client.setQueryData(queryKeys.sessionHistoryRequested, request)
        // A compact request already in flight must never replace the full list.
        await client.cancelQueries({ queryKey: queryKeys.sessions, exact: true })
        if (client.getQueryData(queryKeys.sessionHistoryRequested) !== request) return []
    }
    const response = await client.fetchQuery({
        queryKey: queryKeys.sessions,
        queryFn: ({ signal }) => fetchSessions(api, client, signal),
        staleTime: 0
    })
    return response.sessions
}

export function useSessions(api: ApiClient | null, options: UseSessionsOptions = {}) {
    const queryClient = useQueryClient()
    const enabled = Boolean(api) && (options.enabled ?? true)
    const query = useQuery({
        queryKey: queryKeys.sessions,
        queryFn: ({ signal }) => {
            if (!api) throw new Error('API unavailable')
            return fetchSessions(api, queryClient, signal)
        },
        enabled,
    })
    const loadHistory = useCallback(async () => {
        if (!api) return []
        return loadSessionHistory(api, queryClient)
    }, [api, queryClient])
    const includeHistory = options.includeHistory ?? false
    useEffect(() => {
        if (enabled && includeHistory) void loadHistory().catch(() => {})
    }, [enabled, includeHistory, loadHistory])

    const historyDeferred = query.data?.historyDeferred ?? false
    return {
        sessions: query.data?.sessions ?? [],
        isLoading: query.isLoading || (includeHistory && historyDeferred && !query.isError),
        error: query.error instanceof Error ? query.error.message : query.error ? 'Failed to load sessions' : null,
        refetch: query.refetch,
        historyDeferred,
        historyLoading: historyDeferred && query.isFetching,
        loadHistory,
    }
}
