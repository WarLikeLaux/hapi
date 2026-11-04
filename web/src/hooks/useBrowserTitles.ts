import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'

const key = ['browser-titles'] as const
export const defaultBrowserTitles = { work: 'HAPI', regular: 'HAPI' }

export function useBrowserTitles(api: ApiClient | null) {
    const client = useQueryClient()
    const query = useQuery({ queryKey: key, queryFn: () => api!.getBrowserTitles(), enabled: Boolean(api), staleTime: 30_000 })
    async function save(titles: typeof defaultBrowserTitles) {
        if (!api) throw new Error('API unavailable')
        const saved = await api.saveBrowserTitles(titles)
        client.setQueryData(key, saved)
    }
    return { titles: query.data ?? defaultBrowserTitles, loading: query.isLoading, error: query.error, save }
}
