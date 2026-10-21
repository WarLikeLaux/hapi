import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import type { QuotasResponse } from '@hapi/protocol/quotas'
import type { ApiClient } from '@/api/client'
import { queryKeys } from '@/lib/query-keys'

export function useQuotas(args: { api: ApiClient | null; enabled?: boolean }): {
    snapshots: QuotasResponse['quotas']
    isLoading: boolean
    error: string | null
    refetch: () => void
} {
    const enabled = Boolean((args.enabled ?? true) && args.api)
    const query = useQuery({
        queryKey: queryKeys.quotas,
        queryFn: async () => {
            if (!args.api) throw new Error('API unavailable')
            return await args.api.getQuotas()
        },
        enabled,
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        retry: false,
    })

    // Presentation only: keep MiniMax collection and the raw query cache intact.
    const snapshots = useMemo(() => (query.data?.quotas ?? [])
        .map((snapshot) => ({
            ...snapshot,
            quotas: snapshot.quotas.filter((quota) => !quota.source.startsWith('minimax:')),
            unavailable: snapshot.unavailable.filter((quota) => !quota.source.startsWith('minimax:')),
        }))
        .filter((snapshot) => snapshot.quotas.length > 0 || snapshot.unavailable.length > 0),
    [query.data])

    return {
        snapshots,
        isLoading: enabled && query.isLoading,
        error: query.error instanceof Error ? query.error.message : null,
        refetch: () => {
            void query.refetch()
        },
    }
}
