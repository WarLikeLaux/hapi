import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import type { KlipySearchResponse } from '@hapi/protocol/klipy'
import { useAppContext } from '@/lib/app-context'
import { queryKeys } from '@/lib/query-keys'

/**
 * Search KLIPY GIFs by free-text query. The hub proxies the partner API and
 * keeps the API key server-side; the browser only ever talks to the hub.
 *
 * `q` is required and non-empty — when the picker mounts we fetch `trending`
 * instead.
 */
export function useKlipySearch(params: { q: string; limit?: number; enabled?: boolean }): UseQueryResult<KlipySearchResponse> {
    const { api } = useAppContext()
    const limit = params.limit ?? 12
    return useQuery<KlipySearchResponse>({
        queryKey: queryKeys.klipySearch(params.q, limit),
        enabled: params.enabled !== false && Boolean(api) && params.q.trim().length > 0,
        staleTime: 30_000,
        retry: (failureCount, error) => {
            // 503 from the hub means "operator hasn't configured KLIPY yet" —
            // don't burn retries on a config gap.
            if (error instanceof Error && /503/.test(error.message)) return false
            return failureCount < 2
        },
        queryFn: async () => api!.searchKlipyGifs({ q: params.q, limit })
    })
}

export function useKlipyTrending(params: { limit?: number; enabled?: boolean } = {}): UseQueryResult<KlipySearchResponse> {
    const { api } = useAppContext()
    const limit = params.limit ?? 12
    return useQuery<KlipySearchResponse>({
        queryKey: queryKeys.klipyTrending(limit),
        enabled: params.enabled !== false && Boolean(api),
        staleTime: 60_000,
        retry: (failureCount, error) => {
            if (error instanceof Error && /503/.test(error.message)) return false
            return failureCount < 2
        },
        queryFn: async () => api!.getKlipyTrending({ limit })
    })
}

/**
 * Lightweight availability probe. We use the trending endpoint with limit=1
 * to discover whether the hub has KLIPY configured without rendering a giant
 * grid. The 503-vs-other distinction is enough to decide whether the composer
 * should show the GIF button at all.
 *
 * `enabled` defaults to true so the probe runs eagerly when the chat route
 * mounts — the picker no longer has to discover this on click.
 */
export function useKlipyAvailability(params: { enabled?: boolean } = {}): UseQueryResult<KlipySearchResponse> {
    const { api } = useAppContext()
    return useQuery<KlipySearchResponse>({
        queryKey: queryKeys.klipyAvailability,
        enabled: params.enabled !== false && Boolean(api),
        staleTime: 5 * 60_000,
        // Don't burn retries on a partner outage — the cached "not available"
        // verdict should hold until the operator refreshes the partner key.
        retry: false,
        queryFn: async () => api!.getKlipyTrending({ limit: 1 })
    })
}

/**
 * Convenience selector: `true` once the hub has confirmed it can reach KLIPY.
 * `false` until the probe finishes or after it has failed. Composers use this
 * to decide whether to surface the GIF button at all — a partner outage or a
 * missing key should not produce a button that opens a broken dialog.
 */
export function useKlipyEnabled(params: { enabled?: boolean } = {}): boolean {
    const query = useKlipyAvailability(params)
    return query.isSuccess
}