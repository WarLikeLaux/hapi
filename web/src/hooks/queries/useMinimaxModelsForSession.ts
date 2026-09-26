import { useQuery } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { MinimaxModelSummary } from '@/types/api'
import { queryKeys } from '@/lib/query-keys'

export function useMinimaxModelsForSession(args: {
    api: ApiClient | null
    sessionId?: string | null
    enabled?: boolean
}): {
    availableModels: MinimaxModelSummary[]
    currentModelId: string | null
    isLoading: boolean
    error: string | null
} {
    const enabled = Boolean(args.enabled && args.api && args.sessionId)
    const query = useQuery({
        queryKey: args.sessionId
            ? queryKeys.sessionMinimaxModels(args.sessionId)
            : ['session-minimax-models', 'unknown'] as const,
        queryFn: async () => {
            if (!args.api || !args.sessionId) throw new Error('MiniMax session unavailable')
            return await args.api.getSessionMinimaxModels(args.sessionId)
        },
        enabled,
        staleTime: 30_000,
        retry: false,
    })

    return {
        availableModels: query.data?.availableModels ?? [],
        currentModelId: query.data?.currentModelId ?? null,
        isLoading: query.isLoading,
        error: query.data?.success === false
            ? (query.data.error ?? 'Failed to load MiniMax models')
            : query.error instanceof Error ? query.error.message : null,
    }
}
