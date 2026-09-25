import type { SessionSummary } from '@/types/api'
import { countWorkingSessions, isWorkingSession } from './navigationBadges'
import { getUnreadSessionCount } from './sessionLastSeen'

export type SessionContextId = 'all' | 'work' | 'lab' | 'chill'

/** Minimal session fields used for context detection (list rows and detail header). */
export type SessionContextSource = {
    id: string
    metadata?: SessionSummary['metadata'] | null
}

export interface SessionContextDef {
    id: SessionContextId
    labelKey: string
    defaultLabel: string
    icon: string
}

export const SESSION_CONTEXTS: readonly SessionContextDef[] = [
    { id: 'all', labelKey: 'sessions.context.all', defaultLabel: 'All', icon: '⚡' },
    { id: 'work', labelKey: 'sessions.context.work', defaultLabel: 'Work', icon: '💼' },
    { id: 'lab', labelKey: 'sessions.context.lab', defaultLabel: 'Lab', icon: '🧪' },
    { id: 'chill', labelKey: 'sessions.context.chill', defaultLabel: 'Chill', icon: '💬' },
] as const

/**
 * Generic ticket identifier pattern (e.g., PROJ-123, TASK-456).
 */
const TICKET_PATTERN = /[A-Za-z]{2,10}-\d+/

export interface SessionContextOptions {
    sessionOverrides?: Record<string, SessionContextId> | null
    projectOverrides?: Record<string, SessionContextId> | null
    workAliases?: readonly string[] | null
}

/**
 * Heuristically classifies a session into a context based on project path,
 * directory name, branch name, or project metadata and user-configured aliases.
 */
export function detectDefaultSessionContext(
    session: SessionContextSource,
    workAliases?: readonly string[] | null
): 'work' | 'lab' | 'chill' {
    const rawPath = session.metadata?.worktree?.basePath ?? session.metadata?.path ?? ''
    const normPath = rawPath.replace(/\\/g, '/').toLowerCase()
    const name = (session.metadata?.name ?? '').toLowerCase()
    const branch = session.metadata?.worktree?.branch ?? session.metadata?.worktree?.name ?? ''

    // 1. Check user-configured work keywords / aliases
    const aliases = (workAliases ?? [])
        .map((a) => a.trim().toLowerCase())
        .filter(Boolean)

    if (aliases.length > 0) {
        const matchesAlias = aliases.some(
            (alias) => normPath.includes(alias) || name.includes(alias) || branch.toLowerCase().includes(alias)
        )
        if (matchesAlias) {
            return 'work'
        }
    } else {
        // Minimal generic default if no aliases configured
        if (normPath.includes('/work/') || normPath.startsWith('work/') || name === 'work') {
            return 'work'
        }
    }

    // 2. Check ticket branches (e.g. PROJ-123)
    if (
        TICKET_PATTERN.test(branch) ||
        TICKET_PATTERN.test(rawPath) ||
        TICKET_PATTERN.test(name)
    ) {
        return 'work'
    }

    // 3. Chill / Personal / Scratchpad:
    // Root code directory, "Other", or standalone session without separate repo
    const parts = normPath.split('/').filter(Boolean)
    const lastPart = parts.length > 0 ? parts[parts.length - 1] : ''
    if (
        !normPath ||
        normPath === 'other' ||
        lastPart === 'code' ||
        name === 'code' ||
        lastPart === 'personal' ||
        lastPart === 'sandbox' ||
        lastPart === 'scratchpad'
    ) {
        return 'chill'
    }

    // 4. Lab: specific side projects and tools
    return 'lab'
}

function isOptionsObject(
    overrides?: SessionContextOptions | Record<string, SessionContextId> | null
): overrides is SessionContextOptions {
    if (!overrides || typeof overrides !== 'object') return false
    return 'sessionOverrides' in overrides || 'projectOverrides' in overrides || 'workAliases' in overrides
}

/**
 * Resolves session context taking manual session tag, project override, and
 * user aliases into account.
 *
 * Precedence:
 * 1. Manual per-session tag override
 * 2. Project path / name override
 * 3. Configured aliases & default heuristic
 */
export function resolveSessionContext(
    session: SessionContextSource,
    overrides?: SessionContextOptions | Record<string, SessionContextId> | null
): 'work' | 'lab' | 'chill' {
    const isOpts = isOptionsObject(overrides)
    const sessionOverrides = isOpts ? overrides.sessionOverrides : null
    const projectOverrides = isOpts
        ? overrides.projectOverrides
        : (overrides as Record<string, SessionContextId> | null)
    const workAliases = isOpts ? overrides.workAliases : null

    // 1. Manual per-session tag (highest precedence)
    if (session.id && sessionOverrides && sessionOverrides[session.id] && sessionOverrides[session.id] !== 'all') {
        return sessionOverrides[session.id] as 'work' | 'lab' | 'chill'
    }

    // 2. Project path or name override
    const rawPath = session.metadata?.worktree?.basePath ?? session.metadata?.path ?? ''
    const projectName = session.metadata?.name ?? ''

    if (projectOverrides) {
        if (rawPath && projectOverrides[rawPath] && projectOverrides[rawPath] !== 'all') {
            return projectOverrides[rawPath] as 'work' | 'lab' | 'chill'
        }
        if (projectName && projectOverrides[projectName] && projectOverrides[projectName] !== 'all') {
            return projectOverrides[projectName] as 'work' | 'lab' | 'chill'
        }
    }

    // 3. User aliases & default heuristic
    return detectDefaultSessionContext(session, workAliases)
}

export interface ContextTabStats {
    totalCount: number
    activeCount: number
    workingCount: number
    unreadCount: number
}

/**
 * Calculates total, active, working, and unread counts for each context tab.
 */
export function computeContextStats(
    sessions: readonly SessionSummary[],
    overrides?: SessionContextOptions | Record<string, SessionContextId> | null
): Record<SessionContextId, ContextTabStats> {
    const stats: Record<SessionContextId, ContextTabStats> = {
        all: { totalCount: sessions.length, activeCount: 0, workingCount: 0, unreadCount: 0 },
        work: { totalCount: 0, activeCount: 0, workingCount: 0, unreadCount: 0 },
        lab: { totalCount: 0, activeCount: 0, workingCount: 0, unreadCount: 0 },
        chill: { totalCount: 0, activeCount: 0, workingCount: 0, unreadCount: 0 },
    }

    const grouped: Record<'work' | 'lab' | 'chill', SessionSummary[]> = {
        work: [],
        lab: [],
        chill: [],
    }

    for (const session of sessions) {
        const ctx = resolveSessionContext(session, overrides)
        grouped[ctx].push(session)
        stats[ctx].totalCount += 1
    }

    for (const ctx of ['work', 'lab', 'chill'] as const) {
        stats[ctx].activeCount = grouped[ctx].filter(
            (s) => s.active && s.metadata?.lifecycleState !== 'idle'
        ).length
        stats[ctx].workingCount = countWorkingSessions(grouped[ctx])
        stats[ctx].unreadCount = getUnreadSessionCount(
            grouped[ctx].filter((session) => !isWorkingSession(session))
        )
    }

    stats.all.activeCount = stats.work.activeCount + stats.lab.activeCount + stats.chill.activeCount
    stats.all.workingCount = stats.work.workingCount + stats.lab.workingCount + stats.chill.workingCount
    stats.all.unreadCount = stats.work.unreadCount + stats.lab.unreadCount + stats.chill.unreadCount

    return stats
}
