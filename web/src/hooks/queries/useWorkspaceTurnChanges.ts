import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { WorkspaceTurnDiffResponse } from '@hapi/protocol/apiTypes'
import { queryKeys } from '@/lib/query-keys'

/**
 * Turn-scoped workspace diff, computed by the CLI on demand. Powers the live
 * "code changes" dialog while an agent turn is still running: `enabled` gates
 * on the dialog being open over `pending` changes, and refetchInterval keeps
 * the open dialog current until the turn's final event replaces them.
 *
 * `api`/`sessionId` come as props (from the chat context), not from
 * AppContext, so the component works in tests without query/app providers.
 */
export function useWorkspaceTurnChanges(params: { api?: ApiClient; sessionId?: string; enabled: boolean }): UseQueryResult<WorkspaceTurnDiffResponse> {
    return useQuery<WorkspaceTurnDiffResponse>({
        queryKey: queryKeys.workspaceTurnChanges(params.sessionId ?? ''),
        enabled: params.enabled && Boolean(params.api && params.sessionId),
        staleTime: 0,
        retry: false,
        refetchInterval: 5_000,
        queryFn: () => params.api!.getWorkspaceTurnChanges(params.sessionId!)
    })
}
