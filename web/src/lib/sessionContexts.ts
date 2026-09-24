import type { SessionSummary } from '@/types/api'
import { countWorkingSessions } from './navigationBadges'
import { getUnreadSessionCount } from './sessionLastSeen'

export type SessionContextId = 'all' | 'work' | 'lab' | 'chill'

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

/**
 * Common generic workplace directory/keyword patterns.
 */
const WORK_PATH_PATTERNS = [
    '/work/',
    '/workplace/',
    '/corp/',
    '/corporate/',
    '/company/',
    '/client/',
    '/job/',
]

/**
 * Heuristically classifies a session into a context based on project path,
 * directory name, branch name, or project metadata.
 */
export function detectDefaultSessionContext(session: SessionSummary): 'work' | 'lab' | 'chill' {
    const rawPath = session.metadata?.worktree?.basePath ?? session.metadata?.path ?? ''
    const normPath = rawPath.replace(/\\/g, '/').toLowerCase()
    const name = (session.metadata?.name ?? '').toLowerCase()
    const branch = session.metadata?.worktree?.branch ?? session.metadata?.worktree?.name ?? ''

    // 1. Work: workplace path patterns or ticket branches (e.g. PROJ-123)
    if (
        WORK_PATH_PATTERNS.some((pattern) => normPath.includes(pattern)) ||
        normPath.startsWith('work/') ||
        normPath.startsWith('/work/') ||
        name.includes('work') ||
        TICKET_PATTERN.test(branch) ||
        TICKET_PATTERN.test(rawPath) ||
        TICKET_PATTERN.test(name)
    ) {
        return 'work'
    }

    // 2. Chill / Personal / Scratchpad:
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

    // 3. Lab: specific side projects and tools
    return 'lab'
}

/**
 * Resolves session context taking user project overrides into account.
 */
export function resolveSessionContext(
    session: SessionSummary,
    overrides?: Record<string, SessionContextId> | null
): 'work' | 'lab' | 'chill' {
    const rawPath = session.metadata?.worktree?.basePath ?? session.metadata?.path ?? ''
    const projectName = session.metadata?.name ?? ''

    if (overrides) {
        if (rawPath && overrides[rawPath] && overrides[rawPath] !== 'all') {
            return overrides[rawPath] as 'work' | 'lab' | 'chill'
        }
        if (projectName && overrides[projectName] && overrides[projectName] !== 'all') {
            return overrides[projectName] as 'work' | 'lab' | 'chill'
        }
    }

    return detectDefaultSessionContext(session)
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
    overrides?: Record<string, SessionContextId> | null
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
        stats[ctx].unreadCount = getUnreadSessionCount(grouped[ctx])
    }

    stats.all.activeCount = stats.work.activeCount + stats.lab.activeCount + stats.chill.activeCount
    stats.all.workingCount = stats.work.workingCount + stats.lab.workingCount + stats.chill.workingCount
    stats.all.unreadCount = stats.work.unreadCount + stats.lab.unreadCount + stats.chill.unreadCount

    return stats
}
