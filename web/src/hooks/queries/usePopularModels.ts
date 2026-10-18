import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import type { ApiClient } from '@/api/client'
import type { PopularModelsResponse } from '@hapi/protocol/apiTypes'

export function usePopularModels(api: ApiClient) {
    const query = useQuery({
        queryKey: ['popular-models'],
        queryFn: () => api.getPopularModels(),
        staleTime: 0,
        refetchOnWindowFocus: false,
        retry: false,
    })
    // Freeze the first result for this form. SSE activity and background
    // refetches must not move a model button under the user's pointer.
    const [snapshot, setSnapshot] = useState<PopularModelsResponse | null>(null)
    useEffect(() => {
        if (!query.isFetching && (query.data || query.isError)) setSnapshot(previous => previous ?? query.data ?? { range: { from: 0, to: 0 }, models: [] })
    }, [query.data, query.isError, query.isFetching])
    return { models: snapshot?.models ?? [], isLoading: snapshot === null }
}
