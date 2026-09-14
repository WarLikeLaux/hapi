import { useQuery } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import { getCurrentBranchV2, parseStatusSummaryV2 } from '@/lib/gitParsers'
import { queryKeys } from '@/lib/query-keys'

export function readDisplayGitBranch(statusOutput: string): string | null {
    const summary = parseStatusSummaryV2(statusOutput)
    const branch = getCurrentBranchV2(summary)
    if (branch) return branch
    if (summary.branch.head === '(detached)') {
        const oid = summary.branch.oid
        return oid && oid !== '(initial)' ? `detached@${oid.slice(0, 7)}` : 'detached HEAD'
    }
    return null
}

export function useSessionGitBranch(
    api: ApiClient | null,
    sessionId: string,
    active: boolean,
    enabled = true,
    cacheScope = sessionId
): string | null {
    const query = useQuery({
        queryKey: queryKeys.gitBranch(cacheScope),
        queryFn: async () => {
            if (!api || typeof api.getGitStatus !== 'function') return null
            const result = await api.getGitStatus(sessionId)
            if (!result.success) {
                throw new Error(result.error ?? result.stderr ?? 'Git branch unavailable')
            }
            return readDisplayGitBranch(result.stdout ?? '')
        },
        enabled: Boolean(enabled && api && typeof api.getGitStatus === 'function'),
        staleTime: 5_000,
        refetchInterval: active ? 10_000 : false,
        retry: false,
    })

    return query.data ?? null
}
