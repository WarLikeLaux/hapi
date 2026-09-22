import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAppContext } from '@/lib/app-context'
import { queryKeys } from '@/lib/query-keys'
import { setClaudeGlmBranded } from '@/lib/claudeGlmBranding'

/**
 * App-root observer: mirrors the hub's `claudeBrandedAsGlm` display flag
 * into the local branding store. Renders nothing; mount once inside
 * AppContextProvider (react-query is available app-wide).
 */
export function ClaudeGlmBrandingSync() {
    const { api } = useAppContext()
    const { data } = useQuery({
        queryKey: queryKeys.hubSettings,
        queryFn: async () => {
            if (!api) throw new Error('API unavailable')
            return await api.getHubSettings()
        },
        enabled: Boolean(api),
        staleTime: 30_000,
        refetchInterval: 30_000,
        retry: false,
    })
    const branded = data?.claudeBrandedAsGlm === true

    useEffect(() => {
        setClaudeGlmBranded(branded)
    }, [branded])

    return null
}
