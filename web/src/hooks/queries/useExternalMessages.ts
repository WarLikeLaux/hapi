import { useQuery } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import { queryKeys } from '@/lib/query-keys'

export function useExternalMessages(api: ApiClient | null, conversationId: string) {
    return useQuery({
        queryKey: queryKeys.externalMessages(conversationId),
        queryFn: async () => await api!.getExternalMessages(conversationId),
        enabled: Boolean(api),
        // A background-prefetched snapshot may still be fresh. Opening the
        // actual conversation must nevertheless hit the endpoint so the hub
        // can mark it read, while React Query keeps rendering cached messages.
        refetchOnMount: 'always'
    })
}
