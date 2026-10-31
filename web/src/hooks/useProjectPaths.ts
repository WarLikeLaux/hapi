import { useMemo } from 'react'
import type { ProjectPreference } from '@/api/client'
import type { SessionSummary } from '@/types/api'
import { getSessionUserActivityAt } from '@/components/SessionList'
import { resolveSessionContext, type SessionContextId } from '@/lib/sessionContexts'

export const WORK_PROJECT_PATHS_LIMIT = 10

/**
 * Minimum lifetime session count for a project to appear in the Create Session
 * chip lists. One-off or throwaway directories (e.g. /tmp/random-… or a 30-second
 * scratch repo) get filtered out so they do not crowd the picker.
 */
export const MIN_SESSIONS_FOR_PICKER = 3

export interface ProjectPaths {
    /** Projects classified by `workContextAliases` (or the work-context default), highest session count first. */
    workPaths: string[]
    /** Projects not classified as work, ordered by most recent session activity. */
    recentPaths: string[]
}

export interface SessionContextOptionsForPaths {
    workAliases?: readonly string[] | null
    projectOverrides?: Record<string, SessionContextId> | null
    projects?: readonly ProjectPreference[]
}

/**
 * Classify a path as work using the same resolver the session list uses, but
 * without a session id (no manual session tag applies here). 'all' overrides
 * are treated as "no manual override" by `resolveSessionContext` already.
 */
function isWorkPath(path: string, options: SessionContextOptionsForPaths): boolean {
    const sessionStub = {
        id: '',
        metadata: { path },
    }
    return resolveSessionContext(sessionStub, {
        projectOverrides: options.projectOverrides,
        workAliases: options.workAliases,
    }) === 'work'
}

interface PathStats {
    latestActivity: number
    totalSessions: number
}

/**
 * Distinct project directories on the selected machine, split into a "Working"
 * row (work-context paths, ordered by lifetime session count) and a "Recent"
 * row (everything else, ordered by recent activity). Both are filtered to
 * projects with at least {@link MIN_SESSIONS_FOR_PICKER} lifetime sessions and
 * working projects are capped at {@link workLimit}; the Recent row fits its
 * visible choices to the viewport and keeps the remaining projects accessible.
 */
export function getProjectPaths(
    sessions: readonly SessionSummary[],
    machineId: string | null,
    options: SessionContextOptionsForPaths = {},
    workLimit: number = WORK_PROJECT_PATHS_LIMIT,
    minSessions: number = MIN_SESSIONS_FOR_PICKER
): ProjectPaths {
    const { workAliases = null, projectOverrides = null, projects = [] } = options

    if (!machineId) {
        return { workPaths: [], recentPaths: [] }
    }

    const statsByPath = new Map<string, PathStats>()
    for (const session of sessions) {
        const path = session.metadata?.path?.trim()
        if (!path) continue
        if ((session.metadata?.machineId ?? null) !== machineId) continue
        const activityAt = getSessionUserActivityAt(session)
        const existing = statsByPath.get(path)
        if (existing === undefined) {
            statsByPath.set(path, { latestActivity: activityAt, totalSessions: 1 })
        } else {
            existing.totalSessions += 1
            if (activityAt > existing.latestActivity) {
                existing.latestActivity = activityAt
            }
        }
    }

    const configured = projects.filter(project => project.machineId === machineId)
    for (const project of configured) {
        if (!statsByPath.has(project.path)) statsByPath.set(project.path, { latestActivity: 0, totalSessions: 0 })
    }
    const preferences = new Map(configured.map(project => [project.path, project]))
    const classified = [...statsByPath.entries()]
        .filter(([path, stats]) => !preferences.get(path)?.hidden && (stats.totalSessions >= minSessions || preferences.has(path)))
        .map(([path, stats]) => ({
            path,
            stats,
            isWork: preferences.get(path)?.section === 'work' || (preferences.get(path)?.section !== 'recent' && isWorkPath(path, { workAliases, projectOverrides })),
        }))

    const priority = new Map(configured.filter(project => project.priority).map((project, index) => [project.path, index]))
    const comparePriority = (a: string, b: string) => (priority.get(a) ?? Infinity) - (priority.get(b) ?? Infinity)
    // Working: highest lifetime session count first; recent activity breaks ties.
    const workPaths = classified
        .filter((entry) => entry.isWork)
        .sort((a, b) => {
            const order = comparePriority(a.path, b.path)
            if (order) return order
            if (b.stats.totalSessions !== a.stats.totalSessions) {
                return b.stats.totalSessions - a.stats.totalSessions
            }
            return b.stats.latestActivity - a.stats.latestActivity
        })
        .filter((entry, index) => index < workLimit || preferences.has(entry.path))
        .map((entry) => entry.path)

    // Recent: most recent activity first.
    const recentPaths = classified
        .filter((entry) => !entry.isWork)
        .sort((a, b) => comparePriority(a.path, b.path) || b.stats.latestActivity - a.stats.latestActivity)
        .map((entry) => entry.path)

    return { workPaths, recentPaths }
}

export function useProjectPaths(
    sessions: readonly SessionSummary[],
    machineId: string | null,
    options: SessionContextOptionsForPaths = {}
): ProjectPaths {
    const { workAliases, projectOverrides, projects } = options
    return useMemo(
        () => getProjectPaths(sessions, machineId, { workAliases, projectOverrides, projects }),
        [sessions, machineId, workAliases, projectOverrides, projects]
    )
}