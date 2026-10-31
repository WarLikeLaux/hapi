import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { ApiClient, ProjectPreference } from '@/api/client'

const key = ['project-preferences'] as const

export function useProjectPreferences(api: ApiClient | null) {
    const client = useQueryClient()
    const query = useQuery({
        queryKey: key,
        queryFn: () => api!.getProjectPreferences(),
        enabled: Boolean(api),
        staleTime: 30_000,
    })
    async function save(projects: ProjectPreference[]) {
        if (!api) throw new Error('API unavailable')
        const result = await api.saveProjectPreferences(projects)
        client.setQueryData(key, result)
    }
    return { projects: query.data?.projects ?? [], loading: Boolean(api) && query.isLoading, error: query.error, retry: query.refetch, save }
}
