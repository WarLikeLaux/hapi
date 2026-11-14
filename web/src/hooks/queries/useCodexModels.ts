import { useQuery } from '@tanstack/react-query'
import { RPC_TARGET_MISSING_ERROR_CODE } from '@hapi/protocol/rpcMethods'
import { ApiError, type ApiClient } from '@/api/client'
import type { CodexModelSummary, CodexModelsResponse } from '@/types/api'
import { queryKeys } from '@/lib/query-keys'

function isTemporaryFailure(error: unknown): boolean {
    return (error instanceof ApiError && !error.code && [502, 503, 504].includes(error.status))
        || error instanceof TypeError
        || (error instanceof DOMException && error.name === 'TimeoutError')
}

function safeMessage(message: string): string {
    return /<[^>]*>/.test(message) ? 'Failed to load Codex models' : message.slice(0, 300)
}

function requireCatalog(response: CodexModelsResponse): CodexModelsResponse {
    if (!response.success) throw new Error(safeMessage(response.error ?? 'Failed to load Codex models'))
    return response
}

export function useCodexModels(args: {
    api: ApiClient | null
    sessionId?: string | null
    machineId?: string | null
    preferSession?: boolean
    enabled?: boolean
}): {
    models: CodexModelSummary[]
    isLoading: boolean
    isUnavailable: boolean
    error: string | null
} {
    const { api, sessionId, machineId } = args
    const enabled = Boolean(args.enabled && api && (sessionId || machineId))
    const preferSession = Boolean(enabled && args.preferSession && sessionId)

    const machineQuery = useQuery({
        queryKey: queryKeys.machineCodexModels(machineId ?? 'unknown'),
        queryFn: async () => {
            if (!api) {
                throw new Error('API unavailable')
            }
            if (machineId) {
                return requireCatalog(await api.getMachineCodexModels(machineId))
            }
            throw new Error('Codex models target unavailable')
        },
        enabled: Boolean(enabled && machineId && !preferSession),
        staleTime: 30_000,
        retry: false,
        refetchInterval: (query) => isTemporaryFailure(query.state.error) ? 5_000 : false,
    })

    // Legacy sessions use the shared machine catalog. A shared session uses
    // its live app-server; only missing RPC targets need the other route.
    const useLegacySessionFallback = Boolean(
        enabled
        && sessionId
        && !preferSession
        && (!machineId || (
            machineQuery.error instanceof ApiError
            && machineQuery.error.code === RPC_TARGET_MISSING_ERROR_CODE
        ))
    )
    const sessionQuery = useQuery({
        queryKey: queryKeys.sessionCodexModels(sessionId ?? 'unknown'),
        queryFn: async () => {
            if (!api || !sessionId) {
                throw new Error('API unavailable')
            }
            try {
                return requireCatalog(await api.getSessionCodexModels(sessionId))
            } catch (error) {
                if (preferSession && machineId && error instanceof ApiError
                    && error.code === RPC_TARGET_MISSING_ERROR_CODE) {
                    return requireCatalog(await api.getMachineCodexModels(machineId))
                }
                throw error
            }
        },
        enabled: Boolean(preferSession || useLegacySessionFallback),
        staleTime: 30_000,
        retry: false,
        refetchInterval: (query) => isTemporaryFailure(query.state.error) ? 5_000 : false,
    })
    const query = preferSession || useLegacySessionFallback ? sessionQuery : machineQuery

    const unavailable = isTemporaryFailure(query.error)
    return {
        models: query.data?.models ?? [],
        isLoading: query.isLoading,
        isUnavailable: unavailable,
        error: unavailable ? null : query.error instanceof ApiError
            ? `HTTP ${query.error.status}`
            : query.error instanceof Error
                ? safeMessage(query.error.message)
                : query.error ? 'Failed to load Codex models' : null,
    }
}
