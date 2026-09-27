import { useMemo } from 'react'
import type { Session } from '@/types/api'
import type { ApiClient } from '@/api/client'
import { resolveSessionModelLabel, type SessionModelLabel } from '@/lib/sessionModelLabel'
import { useMinimaxModelsForSession } from '@/hooks/queries/useMinimaxModelsForSession'

/**
 * Resolve the user-facing model label for a session, including the live ACP
 * catalog fallback for dynamic providers (currently minimax). When the session
 * has no explicit `model`, we surface the model the ACP session is actually
 * running so the header / bottom pill do not sit on a bare "Default".
 *
 * Hook is safe to call unconditionally: `useMinimaxModelsForSession` is a
 * no-op when `enabled` is false, which is the case for any non-minimax flavor.
 */
export function useSessionModelLabel(args: {
    session: Session
    api: ApiClient | null
}): SessionModelLabel | null {
    const agentFlavor = args.session.metadata?.flavor ?? null
    const isMinimax = agentFlavor === 'minimax'

    // Always called for Rules of Hooks — `enabled:false` short-circuits the query.
    const minimaxState = useMinimaxModelsForSession({
        api: args.api,
        sessionId: args.session.id,
        enabled: isMinimax && args.session.active,
    })

    return useMemo(
        () => resolveSessionModelLabel({
            session: args.session,
            agentFlavor,
            currentModelId: minimaxState.currentModelId,
            availableModels: minimaxState.availableModels,
            catalogEnabled: isMinimax && args.session.active,
        }),
        [args.session, agentFlavor, isMinimax, minimaxState.currentModelId, minimaxState.availableModels]
    )
}
