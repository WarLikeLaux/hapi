import { useQuery } from '@tanstack/react-query'
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

    return {
        snapshots: query.data?.quotas ?? [],
        isLoading: enabled && query.isLoading,
        error: query.error instanceof Error ? query.error.message : null,
        refetch: () => {
            void query.refetch()
        },
    }
}
