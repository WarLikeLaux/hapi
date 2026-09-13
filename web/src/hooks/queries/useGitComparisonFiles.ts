import { useQuery } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { GitComparisonResponse, GitComparisonScope, GitFileStatus } from '@/types/api'
import { queryKeys } from '@/lib/query-keys'

function toGitFileStatus(file: NonNullable<GitComparisonResponse['files']>[number]): GitFileStatus {
    const normalized = file.path.replaceAll('\\', '/')
    const separator = normalized.lastIndexOf('/')
    return {
        fileName: separator >= 0 ? normalized.slice(separator + 1) : normalized,
        filePath: separator >= 0 ? normalized.slice(0, separator) : '',
        fullPath: normalized,
        status: file.status,
        isStaged: false,
        linesAdded: file.linesAdded,
        linesRemoved: file.linesRemoved,
        ...(file.oldPath ? { oldPath: file.oldPath } : {})
    }
}

export function useGitComparisonFiles(
    api: ApiClient | null,
    sessionId: string | null,
    scope: GitComparisonScope | null
): {
    comparison: GitComparisonResponse | null
    files: GitFileStatus[]
    error: string | null
    isLoading: boolean
    refetch: () => Promise<unknown>
} {
    const resolvedSessionId = sessionId ?? 'unknown'
    const query = useQuery({
        queryKey: queryKeys.gitComparison(resolvedSessionId, scope ?? 'last-commit'),
        queryFn: async () => {
            if (!api || !sessionId || !scope) {
                throw new Error('Session unavailable')
            }
            return await api.getGitComparison(sessionId, scope)
        },
        enabled: Boolean(api && sessionId && scope)
    })

    const response = query.data ?? null
    const queryError = query.error instanceof Error
        ? query.error.message
        : query.error
            ? 'Git comparison unavailable'
            : null

    return {
        comparison: response,
        files: response?.success ? (response.files ?? []).map(toGitFileStatus) : [],
        error: queryError ?? (response && !response.success ? response.error ?? 'Git comparison unavailable' : null),
        isLoading: query.isLoading,
        refetch: query.refetch
    }
}
