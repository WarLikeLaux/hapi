import { useMemo } from 'react'
import type { SessionSummary } from '@/types/api'
import { getSessionUserActivityAt } from '@/components/SessionList'

export const RECENT_PROJECT_PATHS_LIMIT = 10

/**
 * Distinct project directories (per machine) taken from the hub's session
 * list, ordered by the most recent session activity. Replaces the old
 * localStorage history: the hub already knows where sessions ran, so Create
 * Session just mirrors that.
 */
export function getRecentProjectPaths(
    sessions: readonly SessionSummary[],
    machineId: string | null,
    limit: number = RECENT_PROJECT_PATHS_LIMIT
): string[] {
    if (!machineId) return []

    const latestActivityByPath = new Map<string, number>()
    for (const session of sessions) {
        const path = session.metadata?.path?.trim()
        if (!path) continue
        if ((session.metadata?.machineId ?? null) !== machineId) continue
        const activityAt = getSessionUserActivityAt(session)
        const existing = latestActivityByPath.get(path)
        if (existing === undefined || activityAt > existing) {
            latestActivityByPath.set(path, activityAt)
        }
    }

    return [...latestActivityByPath.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit)
        .map(([path]) => path)
}

export function useRecentProjectPaths(
    sessions: readonly SessionSummary[],
    machineId: string | null
): string[] {
    return useMemo(
        () => getRecentProjectPaths(sessions, machineId),
        [sessions, machineId]
    )
}
