import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SessionListScrollAnchor } from './SessionListScrollAnchor'
import type { SessionSummary } from '@/types/api'
import { SESSION_LIFECYCLE_IDLE } from '@hapi/protocol'
import type { ApiClient } from '@/api/client'
import {
    buildSessionSearchScoreIndex,
    sessionMatchesQuery,
    sortSessionsBySearchRelevance,
} from '@/lib/sessionListSearch'
import type { SessionSearchScoreIndex } from '@/lib/sessionListSearch'
import { useLongPress } from '@/hooks/useLongPress'
import { getPlatform, usePlatform } from '@/hooks/usePlatform'
import { useHorizontalSwipe } from '@/hooks/useHorizontalSwipe'
import { useSessionActions } from '@/hooks/mutations/useSessionActions'
import { SessionActionMenu } from '@/components/SessionActionMenu'
import { SessionExportDialog } from '@/components/SessionExportDialog'
import { RenameSessionDialog } from '@/components/RenameSessionDialog'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { CopyIcon, CheckIcon, MarkAllReadIcon } from '@/components/icons'

function PinnedSectionIcon(props: { className?: string }) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className={props.className} aria-hidden="true">
            <path d="M12 17v5" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
            <path d="M5 17h14" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
            <path d="M7 4V2h10v2l-2 5v4l2 2H7l2-2V9Z" />
        </svg>
    )
}
import { cn } from '@/lib/utils'
import { isWorkingSession } from '@/lib/navigationBadges'
import { useTranslation } from '@/lib/use-translation'
import { ContextTabBar } from '@/components/ContextTabBar'
import { useSessionContextFilter } from '@/hooks/useSessionContextFilter'
import { useSessionContextHubSync } from '@/hooks/useSessionContextHubSync'
import { SessionContextPicker } from '@/components/SessionContextPicker'
import {
    SESSION_CONTEXTS,
    computeContextStats,
    resolveSessionContext,
    type SessionContextId,
} from '@/lib/sessionContexts'
import { DEFAULT_SESSION_PREVIEW_LIMIT, useSessionPreviewLimit } from '@/hooks/useSessionPreviewLimit'
import { useSessionListStatusMode } from '@/hooks/useSessionListStatusMode'
import { useShowActiveSessionsOnly } from '@/hooks/useShowActiveSessionsOnly'
import { usePinInProgressSessions } from '@/hooks/usePinInProgressSessions'
import { classifyVisibleSessionAttention, getSessionUnreadActivityAt, sessionIsUnread } from '@/lib/sessionAttention'
import {
    getSessionLastSeenAt,
    getSessionLastSeenSnapshot,
    getSessionManualUnreadAt,
    getUnreadSessionCount,
    markAllSessionsSeen,
    markSessionUnread,
    useSessionLastSeenVersion
} from '@/lib/sessionLastSeen'
import { useSessionRowTooltipIds } from '@/components/HoverTooltip'
import { subscribeCodexImportedSessions } from '@/lib/codexImportedSessions'
import { formatReopenError } from '@/lib/reopenError'
import { resolveCursorReopenGate } from '@/lib/sessionResume'
import { getSessionTitle, hasSessionTitleSignal } from '@/lib/sessionTitle'
import { getWorktreeSessionLabel } from '@/lib/sessionWorktreeLabel'
import { retargetSharePendingTransfer } from '@/lib/sharePendingState'
import type { Machine } from '@/types/api'
import { getMachinePlatform, presentMachineHealth } from '@/lib/machineHealth'
import { MachineFilterBar, MachineFilterMenu } from '@/components/MachineFilterBar'
import { useSessionListMachineFilter } from '@/hooks/useSessionListMachineFilter'
import { useTransientScrollbar } from '@/hooks/useTransientScrollbar'
import { useCursorChatStoreStatus } from '@/hooks/queries/useCursorChatStoreStatus'
import { SessionRowSummary, type SessionActivityTimeBasis } from '@/components/SessionRowSummary'
import { Spinner } from '@/components/Spinner'
import { transferComposerDraftThenNavigate } from '@/lib/composer-draft-transfer'
import { useToast } from '@/lib/toast-context'
import { getPathDisplayName, getPathDisplayNames } from '@/utils/path'
import { useAnchoredMenu } from '@/hooks/useAnchoredMenu'
import { useSessionGitBranch } from '@/hooks/queries/useSessionGitBranch'
import { MessageSearchResults } from '@/components/MessageSearchResults'
import { useMessageSearch } from '@/hooks/queries/useMessageSearch'

export { getWorktreeSessionLabel } from '@/lib/sessionWorktreeLabel'

type SessionGroup = {
    key: string
    directory: string
    displayName: string
    machineId: string | null
    sessions: SessionSummary[]
    latestUserMessageAt: number
    latestUpdatedAt: number
    hasActiveSession: boolean
    hasPinnedSession: boolean
}

type ProjectMenuState = {
    key: string
    title: string
    directory: string
    sessions: SessionSummary[]
    anchorPoint: { x: number; y: number }
}

const RUNNING_BUCKETS = [
    { key: 'working', labelKey: 'session.item.running', colorClass: 'text-[var(--app-badge-success-text)]', pulse: true },
    { key: 'pending', labelKey: 'session.item.pending', colorClass: 'text-[var(--app-badge-warning-text)]', pulse: true },
    { key: 'active', labelKey: 'session.item.active', colorClass: 'text-[var(--app-hint)]', pulse: false },
    // tiann/hapi#1820: connected, but the hub has seen nothing except
    // keepalives for the configured window. Split out so a fleet of zombies
    // does not read as a fleet of ready sessions.
    { key: 'idle', labelKey: 'session.item.idle', colorClass: 'text-[var(--app-hint)]', pulse: false },
] as const

type RunningBucketKey = (typeof RUNNING_BUCKETS)[number]['key']

function getSessionProjectDirectory(session: SessionSummary): string {
    return session.metadata?.worktree?.basePath ?? session.metadata?.path ?? 'Other'
}

function getSessionProjectKey(session: SessionSummary): string {
    return `${session.metadata?.machineId ?? UNKNOWN_MACHINE_ID}::${getSessionProjectDirectory(session)}`
}

export function emptyRunningBuckets(): Record<RunningBucketKey, SessionSummary[]> {
    return { working: [], pending: [], active: [], idle: [] }
}

/**
 * Split the connected sessions into the in-progress / active sub-buckets the
 * pinned sections render. Pure so the bucketing rules stay testable.
 */
export function bucketRunningSessions(
    sessions: SessionSummary[],
    pinInProgressSessions: boolean,
    compare: (a: SessionSummary, b: SessionSummary) => number = (a, b) => b.updatedAt - a.updatedAt
): Record<RunningBucketKey, SessionSummary[]> {
    const buckets = emptyRunningBuckets()
    if (!pinInProgressSessions) {
        return buckets
    }
    for (const session of sessions) {
        if (session.globalPinned || session.pinned) {
            continue
        }
        if (!session.active) {
            continue
        }
        if (session.thinking || (session.backgroundTaskCount ?? 0) > 0) {
            buckets.working.push(session)
        } else if ((session.pendingRequestsCount ?? 0) > 0) {
            buckets.pending.push(session)
        } else if (session.metadata?.lifecycleState === SESSION_LIFECYCLE_IDLE) {
            // Keepalive-only: socket up, no agent progress for hours.
            buckets.idle.push(session)
        } else {
            // Quiet but connected: finished executing, operator will continue.
            buckets.active.push(session)
        }
    }
    for (const key of Object.keys(buckets) as RunningBucketKey[]) {
        buckets[key].sort(compare)
    }
    return buckets
}

/**
 * Sessions that warrant the optional pinned top sections.
 * Any connected session floats — a session that just finished executing stays
 * visible at the top (Active tier) because the operator usually continues the
 * conversation; only disconnected sessions fall into directory groups.
 */
function isPinnedInProgressSession(session: SessionSummary): boolean {
    return session.active
}

export type SessionTimeRange = {
    start: number | null
    end: number | null
}

function parseLocalDate(value: string): Date | null {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
    if (!match) return null
    const year = Number(match[1])
    const month = Number(match[2])
    const day = Number(match[3])
    const date = new Date(year, month - 1, day)
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null
    return date
}

export function getSessionTimeRange(start: string, end: string): SessionTimeRange | null {
    const startDate = parseLocalDate(start)
    const endDate = parseLocalDate(end)
    if (!startDate || !endDate) return null
    if (endDate) endDate.setDate(endDate.getDate() + 1)
    return { start: startDate.getTime(), end: endDate.getTime() }
}

export function sessionMatchesTimeRange(session: SessionSummary, range: SessionTimeRange | null): boolean {
    if (!range) return true
    if (range.start !== null && session.updatedAt < range.start) return false
    if (range.end !== null && session.updatedAt >= range.end) return false
    return true
}

function SessionsEmptyState(props: {
    onNewSession: () => void
    onBrowse?: () => void
}) {
    const { t } = useTranslation()
    return (
        <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
            <svg
                xmlns="http://www.w3.org/2000/svg"
                width="44"
                height="44"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-[var(--app-hint)] opacity-60"
            >
                <rect x="3" y="4" width="18" height="16" rx="2" />
                <path d="M3 9h18" />
                <path d="M8 14h8" />
                <path d="M8 17h5" />
            </svg>
            <div className="text-base font-medium text-[var(--app-fg)]">
                {t('sessions.empty.title')}
            </div>
            <div className="max-w-sm text-sm text-[var(--app-hint)]">
                {t('sessions.empty.hint')}
            </div>
            <div className="flex items-center gap-2 mt-2">
                <button
                    type="button"
                    onClick={props.onNewSession}
                    className="px-4 py-1.5 text-sm rounded-lg bg-[var(--app-button)] text-[var(--app-button-text)] font-medium hover:opacity-90 transition-opacity"
                >
                    {t('sessions.empty.startSession')}
                </button>
                {props.onBrowse && (
                    <button
                        type="button"
                        onClick={props.onBrowse}
                        className="px-4 py-1.5 text-sm rounded-lg border border-[var(--app-border)] text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)] transition-colors"
                    >
                        {t('sessions.empty.browse')}
                    </button>
                )}
            </div>
        </div>
    )
}

type MachineGroup = {
    machineId: string | null
    label: string
    projectGroups: SessionGroup[]
    totalSessions: number
    latestUserMessageAt: number
}

export const UNKNOWN_MACHINE_ID = '__unknown__'
export const GROUP_SESSION_PREVIEW_LIMIT = DEFAULT_SESSION_PREVIEW_LIMIT
export const RECENT_SESSION_BATCH_SIZE = 5

export function getSessionUserActivityAt(session: SessionSummary): number {
    return session.lastUserMessageAt || session.createdAt || session.updatedAt
}

export function sortSessionsByUserActivity(sessions: SessionSummary[]): SessionSummary[] {
    return [...sessions].sort((a, b) => {
        const activityDelta = getSessionUserActivityAt(a) - getSessionUserActivityAt(b)
        return activityDelta || a.id.localeCompare(b.id)
    })
}

export function sortSessionsByNewestUserActivity(sessions: SessionSummary[]): SessionSummary[] {
    return [...sessions].sort((a, b) => {
        const activityDelta = getSessionUserActivityAt(b) - getSessionUserActivityAt(a)
        return activityDelta || a.id.localeCompare(b.id)
    })
}

export function sortSessionsByNewestAgentActivity(sessions: SessionSummary[]): SessionSummary[] {
    return [...sessions].sort((a, b) => (
        getSessionUnreadActivityAt(b) - getSessionUnreadActivityAt(a) || a.id.localeCompare(b.id)
    ))
}

export function isNewEmptySession(session: SessionSummary): boolean {
    if (!session.active) return false
    if (session.hasConversationContent) return false
    if ((session.lastMessageAt ?? 0) > 0) return false
    if ((session.lastAgentMessageAt ?? 0) > 0) return false
    return true
}

export function getEmptySessionTime(session: SessionSummary): number {
    return session.createdAt || session.activeAt || session.updatedAt || 0
}

export function sortActiveSessions(sessions: SessionSummary[]): SessionSummary[] {
    return [...sessions].sort((a, b) => {
        const aEmpty = isNewEmptySession(a)
        const bEmpty = isNewEmptySession(b)
        if (aEmpty && !bEmpty) return -1
        if (!aEmpty && bEmpty) return 1
        if (aEmpty && bEmpty) {
            const timeA = getEmptySessionTime(a)
            const timeB = getEmptySessionTime(b)
            return timeB - timeA || a.id.localeCompare(b.id)
        }
        return getSessionUnreadActivityAt(b) - getSessionUnreadActivityAt(a) || a.id.localeCompare(b.id)
    })
}

export function getSessionDedupKey(session: SessionSummary): string | null {
    const agentId = session.metadata?.agentSessionId?.trim()
    if (!agentId) return null
    // Scope by flavor: agentSessionId is flattened from native ids and can retain a
    // stale cross-flavor value (codexSessionId ?? claudeSessionId ?? ...).
    return `${session.metadata?.flavor ?? 'unknown'}:${agentId}`
}

export function deduplicateSessionsByAgentId(sessions: SessionSummary[], selectedSessionId?: string | null): SessionSummary[] {
    const byAgentId = new Map<string, SessionSummary[]>()
    const result: SessionSummary[] = []

    for (const session of sessions) {
        const dedupKey = getSessionDedupKey(session)
        if (!dedupKey) {
            result.push(session)
            continue
        }
        const group = byAgentId.get(dedupKey)
        if (group) {
            group.push(session)
        } else {
            byAgentId.set(dedupKey, [session])
        }
    }

    for (const group of byAgentId.values()) {
        group.sort((a, b) => {
            // Active session always wins — it's the live connection
            if (a.active !== b.active) return a.active ? -1 : 1
            // Among inactive duplicates, keep the selected one visible
            if (a.id === selectedSessionId) return -1
            if (b.id === selectedSessionId) return 1
            // Preserve an explicit pin when otherwise choosing by recency
            if (Boolean(a.globalPinned) !== Boolean(b.globalPinned)) return a.globalPinned ? -1 : 1
            if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1
            return b.updatedAt - a.updatedAt
        })
        result.push(group[0])
    }

    return result
}

export function isSidebarEmptySessionStub(session: SessionSummary): boolean {
    if (session.active || session.hasConversationContent) return false
    const meta = session.metadata
    if (!meta) return true
    if (meta.agentSessionId?.trim()) return false
    if (hasSessionTitleSignal(session)) return false
    return true
}

export function shouldShowSessionInSidebar(session: SessionSummary, selectedSessionId?: string | null): boolean {
    if (session.id === selectedSessionId) return true
    if (session.active || session.pinned || session.globalPinned) return true
    return !isSidebarEmptySessionStub(session)
}

export function prepareSidebarSessions(sessions: SessionSummary[], selectedSessionId?: string | null): SessionSummary[] {
    return deduplicateSessionsByAgentId(sessions, selectedSessionId)
        .filter(session => shouldShowSessionInSidebar(session, selectedSessionId))
}

// "Active sessions only" view: hide inactive sessions, but never hide the one the
// operator currently has open — otherwise toggling the filter would yank the
// selected session out from under them.
export function filterActiveSessionsOnly(sessions: SessionSummary[], selectedSessionId?: string | null): SessionSummary[] {
    return sessions.filter(session => (
        session.active
        || session.pinned
        || session.globalPinned
        || session.id === selectedSessionId
    ))
}

// Transient unread lens: hide sessions the operator has already seen.
// Keep the open session visible. Not Overseer / "needs attention" — just unread.
export function filterUnreadSessionsOnly(
    sessions: SessionSummary[],
    selectedSessionId: string | null | undefined,
    getLastSeenAt: (sessionId: string) => number
): SessionSummary[] {
    return sessions.filter(session =>
        session.id === selectedSessionId
        || sessionIsUnread(session, { lastSeenAt: getLastSeenAt(session.id) })
    )
}

// Paginated session previews move one batch at a time in either direction.
// Counts always stay within the configured preview floor and the group total.
export function getNextSessionVisibleCount(current: number, step: number, total: number): number {
    return Math.min(current + Math.max(1, step), total)
}

export function getPreviousSessionVisibleCount(current: number, step: number): number {
    const normalizedStep = Math.max(1, step)
    return Math.max(normalizedStep, current - normalizedStep)
}

function groupSessionsByDirectory(
    sessions: SessionSummary[],
    displayNames?: ReadonlyMap<string, string>
): SessionGroup[] {
    const groups = new Map<string, { directory: string; machineId: string | null; sessions: SessionSummary[] }>()

    sessions.forEach(session => {
        const path = getSessionProjectDirectory(session)
        const machineId = session.metadata?.machineId ?? null
        const key = getSessionProjectKey(session)
        if (!groups.has(key)) {
            groups.set(key, {
                directory: path,
                machineId,
                sessions: []
            })
        }
        groups.get(key)!.sessions.push(session)
    })

    return Array.from(groups.entries())
        .map(([key, group]) => {
            const sortedSessions = sortSessionsByUserActivity(group.sessions)
            const latestUserMessageAt = group.sessions.reduce(
                (max, s) => Math.max(max, getSessionUserActivityAt(s)),
                -Infinity
            )
            const latestUpdatedAt = group.sessions.reduce(
                (max, s) => Math.max(max, s.updatedAt),
                -Infinity
            )
            const displayName = displayNames?.get(group.directory) ?? getPathDisplayName(group.directory)

            return {
                key,
                directory: group.directory,
                displayName,
                machineId: group.machineId,
                sessions: sortedSessions,
                latestUserMessageAt,
                latestUpdatedAt,
                hasActiveSession: group.sessions.some((session) => session.active),
                hasPinnedSession: group.sessions.some((session) => session.pinned),
            }
        })
        .sort((a, b) => {
            const activityDelta = a.latestUserMessageAt - b.latestUserMessageAt
            return activityDelta || a.key.localeCompare(b.key)
        })
}

/**
 * Apply upstream relevance without replacing the fork's activity ordering when
 * scores tie. Project pins remain one contiguous block so the divider cannot
 * jump back and forth through a search result.
 */
function sortSessionsBySearchRelevancePreservingForkOrder(
    sessions: readonly SessionSummary[],
    index: SessionSearchScoreIndex,
    preserveProjectPins = false
): SessionSummary[] {
    const rankBucket = (bucket: readonly SessionSummary[]) => bucket
        .map((session, originalIndex) => ({ session, originalIndex }))
        .sort((a, b) => (
            (index.scores.get(b.session.id) ?? 0) - (index.scores.get(a.session.id) ?? 0)
            || a.originalIndex - b.originalIndex
        ))
        .map(({ session }) => session)

    if (!preserveProjectPins) return rankBucket(sessions)
    return [
        ...rankBucket(sessions.filter((session) => session.pinned)),
        ...rankBucket(sessions.filter((session) => !session.pinned)),
    ]
}

function rankSessionGroupsBySearchRelevancePreservingForkOrder(
    groups: readonly SessionGroup[],
    index: SessionSearchScoreIndex
): SessionGroup[] {
    return groups
        .map((group, originalIndex) => ({
            group: {
                ...group,
                sessions: sortSessionsBySearchRelevancePreservingForkOrder(group.sessions, index, true),
            },
            originalIndex,
            score: Math.max(...group.sessions.map((session) => index.scores.get(session.id) ?? 0)),
        }))
        .sort((a, b) => b.score - a.score || a.originalIndex - b.originalIndex)
        .map(({ group }) => group)
}


export function expandSelectedSessionCollapseOverrides(
    overrides: Map<string, boolean>,
    group: { key: string }
): Map<string, boolean> {
    // Keep auto-expanded paths open after selection moves so content above the
    // clicked row does not collapse and displace the sidebar viewport.
    if (overrides.get(group.key) === false) {
        return overrides
    }

    const next = new Map(overrides)
    next.set(group.key, false)
    return next
}

function groupByMachine(
    groups: SessionGroup[],
    resolveMachineLabel: (id: string | null) => string
): MachineGroup[] {
    const map = new Map<string, MachineGroup>()
    for (const g of groups) {
        const key = g.machineId ?? UNKNOWN_MACHINE_ID
        let mg = map.get(key)
        if (!mg) {
            mg = {
                machineId: g.machineId,
                label: resolveMachineLabel(g.machineId),
                projectGroups: [],
                totalSessions: 0,
                latestUserMessageAt: 0,
            }
            map.set(key, mg)
        }
        mg.projectGroups.push(g)
        mg.totalSessions += g.sessions.length
        if (g.latestUserMessageAt > mg.latestUserMessageAt) mg.latestUserMessageAt = g.latestUserMessageAt
    }
    return [...map.values()].sort((a, b) => {
        const activityDelta = a.latestUserMessageAt - b.latestUserMessageAt
        return activityDelta || a.label.localeCompare(b.label)
    })
}

function CopyPathButton({ path, className }: { path: string; className?: string }) {
    const [copied, setCopied] = useState(false)
    const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined)

    const handleClick = (e: React.MouseEvent) => {
        e.stopPropagation()
        navigator.clipboard.writeText(path)
        setCopied(true)
        clearTimeout(timerRef.current)
        timerRef.current = setTimeout(() => setCopied(false), 1500)
    }

    useEffect(() => () => clearTimeout(timerRef.current), [])

    return (
        <button
            type="button"
            className={`shrink-0 p-0.5 rounded transition-colors ${copied ? 'text-[var(--app-badge-success-text)]' : 'text-[var(--app-hint)] hover:text-[var(--app-fg)]'} ${className ?? ''}`}
            title={copied ? 'Copied!' : `Copy: ${path}`}
            onClick={handleClick}
        >
            {copied
                ? <CheckIcon className="h-3.5 w-3.5" />
                : <CopyIcon className="h-3.5 w-3.5" />
            }
        </button>
    )
}


function SearchIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
        </svg>
    )
}

function XIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
        </svg>
    )
}

function PlusIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
    )
}

function ChevronIcon(props: { className?: string; collapsed?: boolean }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`${props.className ?? ''} transition-transform duration-200 ${props.collapsed ? '' : 'rotate-90'}`}
        >
            <polyline points="9 18 15 12 9 6" />
        </svg>
    )
}

function ProjectTrashIcon(props: { className?: string }) {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={props.className} aria-hidden="true">
            <path d="M3 6h18" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
            <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        </svg>
    )
}

function ProjectActionMenu(props: {
    state: ProjectMenuState | null
    onClose: () => void
    onDelete: (target: ProjectMenuState) => void
    currentContext?: SessionContextId
    onSetContext?: (context: SessionContextId | null) => void
}) {
    const { t } = useTranslation()
    const anchorPoint = props.state?.anchorPoint ?? { x: 0, y: 0 }
    const { menuRef, menuStyle } = useAnchoredMenu({
        isOpen: props.state !== null,
        onClose: props.onClose,
        anchorPoint,
        align: 'start',
    })

    if (!props.state) return null
    const target = props.state

    return (
        <div
            ref={menuRef}
            className="fixed z-50 box-border w-max max-w-[calc(100vw-16px)] rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] p-1 shadow-lg animate-menu-pop"
            style={menuStyle}
        >
            <div className="max-w-64 truncate px-3 py-1.5 text-xs font-medium text-[var(--app-hint)]" title={target.title}>
                {target.title}
            </div>
            {props.onSetContext ? (
                <div className="border-b border-[var(--app-border)] pb-1 mb-1">
                    <div className="px-3 py-1 text-[11px] font-semibold text-[var(--app-hint)] uppercase tracking-wider">
                        {t('sessions.context.setLabel')}
                    </div>
                    <SessionContextPicker
                        currentContext={props.currentContext}
                        onClose={props.onClose}
                        onSelect={(ctx) => props.onSetContext?.(ctx)}
                    />
                </div>
            ) : null}
            <div role="menu">
                <button
                    type="button"
                    role="menuitem"
                    className="flex w-full items-center gap-3 rounded-md py-2 pl-3 pr-6 text-left text-base text-red-500 transition-colors hover:bg-red-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                    onClick={() => {
                        props.onClose()
                        props.onDelete(target)
                    }}
                >
                    <ProjectTrashIcon className="h-[18px] w-[18px] shrink-0" />
                    {t('sessions.project.deleteAll')}
                </button>
            </div>
        </div>
    )
}

function SessionPreviewArrowIcon(props: { direction: 'up' | 'down'; className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
            aria-hidden="true"
        >
            {props.direction === 'up' ? (
                <path d="M12 19V5m-6 6 6-6 6 6" />
            ) : (
                <path d="M12 5v14m6-6-6 6-6-6" />
            )}
        </svg>
    )
}

export { getSessionTitle } from '@/lib/sessionTitle'
export { sessionMatchesQuery } from '@/lib/sessionListSearch'

export function normalizeSearch(value: string | null | undefined): string {
    return (value ?? '').trim().toLowerCase()
}


export function getVisibleSessionPreview(
    sessions: SessionSummary[],
    options: {
        expanded?: boolean
        selectedSessionId?: string | null
        limit?: number
    } = {}
): SessionSummary[] {
    const limit = options.limit ?? GROUP_SESSION_PREVIEW_LIMIT
    if (options.expanded || sessions.length <= limit) return sessions

    const requiredIds = new Set<string>()
    for (const session of sessions) {
        if (session.pendingRequestsCount > 0) requiredIds.add(session.id)
    }
    if (options.selectedSessionId && sessions.some(session => session.id === options.selectedSessionId)) {
        requiredIds.add(options.selectedSessionId)
    }

    const firstRecentIndex = Math.max(0, sessions.length - limit)
    const visible: SessionSummary[] = sessions.filter((session, index) => {
        return index >= firstRecentIndex || requiredIds.has(session.id)
    })

    for (let index = 0; visible.length > limit && index < visible.length;) {
        const session = visible[index]
        if (!session || requiredIds.has(session.id)) {
            index += 1
            continue
        }
        visible.splice(index, 1)
    }

    return visible
}

export function shouldShowPinnedDivider(sessions: SessionSummary[], index: number): boolean {
    if (index <= 0 || index >= sessions.length) return false
    return Boolean(sessions[index - 1]?.pinned) && !sessions[index]?.pinned
}

function CalendarIcon(props: { className?: string }) {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={props.className}>
            <rect x="3" y="5" width="18" height="16" rx="2" />
            <path d="M16 3v4M8 3v4M3 10h18" />
        </svg>
    )
}

function formatDateValue(date: Date): string {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
}

function SessionDateRangePicker(props: {
    start: string
    end: string
    sessionActivityDates: ReadonlySet<string>
    onChange: (start: string, end: string) => void
    onClear: () => void
    onClose: () => void
    align: 'left' | 'right'
}) {
    const { t } = useTranslation()
    const initialDate = parseLocalDate(props.start) ?? new Date()
    const [visibleMonth, setVisibleMonth] = useState(() => new Date(initialDate.getFullYear(), initialDate.getMonth(), 1))
    const today = formatDateValue(new Date())
    const firstWeekday = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), 1).getDay()
    const daysInMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 0).getDate()
    const weekdays = Array.from({ length: 7 }, (_, day) => (
        new Intl.DateTimeFormat(undefined, { weekday: 'narrow' }).format(new Date(2026, 5, 7 + day))
    ))

    const selectDate = (value: string) => {
        if (!props.start || props.end) {
            props.onChange(value, '')
            return
        }
        props.onChange(value < props.start ? value : props.start, value < props.start ? props.start : value)
        props.onClose()
    }

    return (
        <div className={cn(
            'absolute top-full z-30 mt-2 w-72 rounded-xl border border-[var(--app-border)] bg-[var(--app-bg)] p-3 shadow-xl',
            props.align === 'left' ? 'left-0' : 'right-0'
        )}>
            <div className="mb-2 flex items-center justify-between">
                <button
                    type="button"
                    onClick={() => setVisibleMonth(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() - 1, 1))}
                    className="rounded-lg p-1.5 text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)]"
                    aria-label={t('sessions.timeFilter.previousMonth')}
                >
                    <span aria-hidden="true">‹</span>
                </button>
                <div className="text-sm font-medium">
                    {visibleMonth.toLocaleDateString(undefined, { year: 'numeric', month: 'long' })}
                </div>
                <button
                    type="button"
                    onClick={() => setVisibleMonth(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 1))}
                    className="rounded-lg p-1.5 text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)]"
                    aria-label={t('sessions.timeFilter.nextMonth')}
                >
                    <span aria-hidden="true">›</span>
                </button>
            </div>
            <div className="mb-1 grid grid-cols-7 text-center text-[10px] text-[var(--app-hint)]">
                {weekdays.map((weekday, index) => <div key={`${weekday}-${index}`} className="py-1">{weekday}</div>)}
            </div>
            <div className="grid grid-cols-7 gap-0.5">
                {Array.from({ length: firstWeekday }, (_, index) => <div key={`blank-${index}`} />)}
                {Array.from({ length: daysInMonth }, (_, index) => {
                    const date = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), index + 1)
                    const value = formatDateValue(date)
                    const isToday = value === today
                    const isEndpoint = value === props.start || value === props.end
                    const isInRange = Boolean(props.start && props.end && value > props.start && value < props.end)
                    const hasSessionActivity = props.sessionActivityDates.has(value)
                    const dateLabel = date.toLocaleDateString()
                    const activityLabel = hasSessionActivity
                        ? t('sessions.timeFilter.dayWithActivity', { date: dateLabel })
                        : dateLabel
                    return (
                        <button
                            key={value}
                            type="button"
                            onClick={() => selectDate(value)}
                            aria-label={activityLabel}
                            aria-current={isToday ? 'date' : undefined}
                            title={hasSessionActivity ? activityLabel : undefined}
                            className={cn(
                                'h-8 rounded-lg text-xs transition-colors',
                                isEndpoint && 'bg-[var(--app-button)] text-[var(--app-button-text)]',
                                isInRange && 'bg-[var(--app-link)]/15 text-[var(--app-link)]',
                                !isEndpoint && !isInRange && isToday && 'bg-[var(--app-subtle-bg)]',
                                !isEndpoint && !isInRange && hasSessionActivity && 'text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)]',
                                !isEndpoint && !isInRange && !hasSessionActivity && 'text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)]'
                            )}
                        >
                            {index + 1}
                        </button>
                    )
                })}
            </div>
            <div className="mt-2 flex items-center justify-between border-t border-[var(--app-divider)] pt-2 text-xs">
                <span className="text-[var(--app-hint)]">
                    {!props.start
                        ? t('sessions.timeFilter.pickStart')
                        : !props.end
                            ? t('sessions.timeFilter.pickEnd')
                            : `${props.start} – ${props.end}`}
                </span>
                {props.start ? (
                    <button type="button" onClick={props.onClear} className="text-[var(--app-link)]">
                        {t('sessions.timeFilter.clear')}
                    </button>
                ) : null}
            </div>
        </div>
    )
}

export function SessionListSearch(props: {
    value: string
    onChange: (value: string) => void
    customStart: string
    customEnd: string
    sessionActivityDates: ReadonlySet<string>
    onDateRangeChange: (start: string, end: string) => void
    expanded: boolean
    onExpandedChange: (expanded: boolean) => void
}) {
    const { t } = useTranslation()
    const [datePickerOpen, setDatePickerOpen] = useState(false)
    const inputRef = useRef<HTMLInputElement>(null)
    const collapsedButtonRef = useRef<HTMLButtonElement>(null)
    const dateButtonRef = useRef<HTMLButtonElement>(null)
    const hasDateRange = Boolean(props.customStart && props.customEnd)

    useEffect(() => {
        if (props.expanded) {
            inputRef.current?.focus()
        } else {
            setDatePickerOpen(false)
        }
    }, [props.expanded])

    const renderDateFilter = (variant: 'standalone' | 'embedded') => {
        const returnFocus = () => {
            (variant === 'embedded' ? inputRef.current : dateButtonRef.current)?.focus()
        }

        return (
            <>
                <button
                    ref={dateButtonRef}
                    type="button"
                    onClick={() => setDatePickerOpen(open => !open)}
                    className={cn(
                        'relative shrink-0 transition-colors hover:bg-[var(--app-subtle-bg)]',
                        variant === 'standalone'
                            ? 'rounded-full p-1.5 hover:text-[var(--app-fg)]'
                            : 'flex items-center rounded-r-lg rounded-l-md px-1',
                        hasDateRange ? 'text-[var(--app-link)]' : 'text-[var(--app-hint)]'
                    )}
                    title={hasDateRange ? `${props.customStart} – ${props.customEnd}` : t('sessions.timeFilter.label')}
                    aria-label={hasDateRange
                        ? `${t('sessions.timeFilter.label')}: ${props.customStart} – ${props.customEnd}`
                        : t('sessions.timeFilter.label')}
                    aria-expanded={datePickerOpen}
                >
                    <CalendarIcon className="h-5 w-5" />
                    {hasDateRange ? (
                        <span className={cn(
                            'absolute h-1.5 w-1.5 rounded-full bg-[var(--app-link)]',
                            variant === 'standalone' ? 'right-0.5 top-0.5' : 'right-1 top-1'
                        )} />
                    ) : null}
                </button>
                {datePickerOpen ? (
                    <>
                        <button
                            type="button"
                            aria-label={t('sessions.timeFilter.close')}
                            className="fixed inset-0 z-20 cursor-default"
                            onClick={() => {
                                setDatePickerOpen(false)
                                returnFocus()
                            }}
                        />
                        <SessionDateRangePicker
                            start={props.customStart}
                            end={props.customEnd}
                            sessionActivityDates={props.sessionActivityDates}
                            onChange={props.onDateRangeChange}
                            onClear={() => {
                                props.onDateRangeChange('', '')
                                // The footer Clear button unmounts once the range is
                                // empty; return focus so it does not drop to <body>.
                                returnFocus()
                            }}
                            onClose={() => {
                                setDatePickerOpen(false)
                                returnFocus()
                            }}
                            align={variant === 'standalone' ? 'left' : 'right'}
                        />
                    </>
                ) : null}
            </>
        )
    }

    const searchLabel = t('sessions.search.open')

    if (!props.expanded) {
        const hasTextQuery = props.value.length > 0
        const collapsedLabel = hasTextQuery ? `${searchLabel}: ${props.value}` : searchLabel
        return (
            <div className="relative flex items-center gap-1">
                <div className={cn(
                    'relative flex min-w-0 items-center rounded-full transition-colors',
                    hasTextQuery
                        // Keep the query and its clear action inside the same compact chip.
                        ? 'max-w-[9rem] bg-[var(--app-chat-user-chip-bg)] text-[var(--app-chat-user-chip-fg)]'
                        : 'shrink-0'
                )}>
                    <button
                        ref={collapsedButtonRef}
                        type="button"
                        onClick={() => props.onExpandedChange(true)}
                        className={cn(
                            'relative flex min-w-0 items-center gap-1 transition-colors',
                            hasTextQuery
                                ? 'flex-1 rounded-l-full bg-[var(--app-chat-user-chip-bg)] px-2 py-1 text-[var(--app-chat-user-chip-fg)] hover:opacity-90'
                                : 'shrink-0 rounded-full p-1.5 text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)]'
                        )}
                        title={collapsedLabel}
                        aria-label={collapsedLabel}
                    >
                        <SearchIcon className="h-5 w-5 shrink-0" />
                        {hasTextQuery ? (
                            <span className="min-w-0 truncate text-xs font-medium">{props.value}</span>
                        ) : null}
                    </button>
                    {hasTextQuery ? (
                        <button
                            type="button"
                            onClick={() => {
                                props.onChange('')
                                // The clear button unmounts with the query; keep focus on
                                // the collapsed search trigger instead of dropping to body.
                                collapsedButtonRef.current?.focus()
                            }}
                            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-r-full bg-[var(--app-chat-user-chip-action-bg)] text-[var(--app-chat-user-chip-action-fg)] transition-colors hover:text-[var(--app-chat-user-chip-action-hover-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)] focus-visible:ring-inset"
                            title={t('sessions.search.clear')}
                            aria-label={t('sessions.search.clear')}
                        >
                            <XIcon className="h-3.5 w-3.5" />
                        </button>
                    ) : null}
                </div>
            </div>
        )
    }

    return (
        <div
            className="relative min-w-0 flex-1"
            onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                    props.onExpandedChange(false)
                }
            }}
        >
            <div className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-[var(--app-hint)]">
                <SearchIcon className="h-3.5 w-3.5" />
            </div>
            <input
                ref={inputRef}
                type="search"
                value={props.value}
                onChange={(event) => props.onChange(event.target.value)}
                placeholder={t('sessions.search.placeholder')}
                aria-label={searchLabel}
                title={searchLabel}
                className={cn(
                    'w-full appearance-none rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] py-1.5 pl-8 text-sm text-[var(--app-fg)] outline-none transition-colors placeholder:text-[var(--app-hint)] [text-overflow:ellipsis] focus:border-[var(--app-link)] [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden',
                    props.value ? 'pr-16' : 'pr-7'
                )}
            />
            {props.value ? (
                <button
                    type="button"
                    onClick={() => {
                        props.onChange('')
                        // The clear button unmounts with the query; keep focus off <body>
                        // so a later outside click still routes blur through the wrapper.
                        inputRef.current?.focus()
                    }}
                    className="absolute inset-y-0 right-9 flex items-center rounded p-0.5 text-[var(--app-hint)] hover:text-[var(--app-fg)]"
                    title={t('sessions.search.clear')}
                >
                    <XIcon className="h-3.5 w-3.5" />
                </button>
            ) : null}
            <div className="absolute inset-y-0 right-0 flex items-stretch">
                {renderDateFilter('embedded')}
            </div>
        </div>
    )
}

function SessionItem(props: {
    session: SessionSummary
    onSelect: (sessionId: string) => void
    onContinueInFolder?: (session: SessionSummary) => void
    showPath?: boolean
    api: ApiClient | null
    titleSuggestionAvailable?: boolean
    selected?: boolean
    showDetailedStatus?: boolean
    inRunningSection?: boolean
    projectLabel?: string
    machineLabel?: string
    activityTimeBasis?: SessionActivityTimeBasis
    lastSeenVersion: number
    currentContext?: SessionContextId
    onSetContext?: (context: SessionContextId | null) => void
}) {
    const { t } = useTranslation()
    const { addToast } = useToast()
    const {
        session: s,
        onSelect,
        onContinueInFolder,
        showPath = true,
        api,
        titleSuggestionAvailable = false,
        selected = false,
        showDetailedStatus = false,
        inRunningSection = false,
        projectLabel,
        machineLabel,
        activityTimeBasis,
        lastSeenVersion
    } = props
    const { haptic } = usePlatform()
    const [menuOpen, setMenuOpen] = useState(false)
    const [menuAnchorPoint, setMenuAnchorPoint] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
    const [renameOpen, setRenameOpen] = useState(false)
    const [exportOpen, setExportOpen] = useState(false)
    const [archiveOpen, setArchiveOpen] = useState(false)
    const [restartOpen, setRestartOpen] = useState(false)
    const [deleteOpen, setDeleteOpen] = useState(false)
    const {
        status: cursorChatStoreStatus,
        isApplicable: cursorChatStoreApplicable,
        error: cursorChatStoreError,
        isLoading: cursorChatStoreLoading,
    } = useCursorChatStoreStatus({
        api,
        session: s,
        enabled: menuOpen
    })
    const cursorReopenGate = resolveCursorReopenGate({
        applicable: cursorChatStoreApplicable,
        onDisk: cursorChatStoreStatus?.onDisk,
        error: cursorChatStoreError,
        isLoading: cursorChatStoreLoading,
    })
    const cursorReopenDisabledReason = cursorReopenGate.disabledReason === 'missing'
        ? t('session.action.reopenCursorMissing')
        : cursorReopenGate.disabledReason === 'checking'
            ? t('session.action.reopenCursorChecking')
            : undefined
    const cursorReopenUnverifiedHint = cursorReopenGate.probeUnverified
        ? t('session.action.reopenCursorUnverified')
            : undefined
    const gitBranchScope = `${s.metadata?.machineId ?? s.id}:${s.metadata?.path ?? s.id}`
    const liveGitBranch = useSessionGitBranch(api, s.id, s.active, inRunningSection, gitBranchScope)
    const gitBranch = inRunningSection
        ? liveGitBranch ?? s.metadata?.worktree?.branch?.trim() ?? undefined
        : undefined

    const { archiveSession, reopenSession, restartSession, renameSession, suggestSessionTitle, updateSessionSummary, deleteSession, setPinMode, isPending } = useSessionActions(
        api,
        s.id,
        s.metadata?.flavor ?? null
    )
    const [reopenError, setReopenError] = useState<string | null>(null)

    const handleSetPinMode = async (mode: 'none' | 'project' | 'global') => {
        try {
            await setPinMode(mode)
        } catch (error) {
            addToast({
                title: t('session.action.pinFailed'),
                body: error instanceof Error ? error.message : t('dialog.error.default'),
                sessionId: s.id,
                url: `/sessions/${s.id}`
            })
        }
    }

    const followReopenedSession = async (result: Awaited<ReturnType<typeof reopenSession>>) => {
        // resumeSession may merge the row into a freshly-spawned sessionId.
        // Follow it so the operator lands on the live session.
        if (result.sessionId && result.sessionId !== s.id) {
            retargetSharePendingTransfer(s.id, result.sessionId)
            await transferComposerDraftThenNavigate(
                s.id,
                result.sessionId,
                () => onSelect(result.sessionId),
            )
        }
    }

    const handleReopen = async () => {
        setReopenError(null)
        try {
            await followReopenedSession(await reopenSession())
        } catch (error) {
            setReopenError(formatReopenError(error))
        }
    }

    const handleRestart = async () => {
        await followReopenedSession(await restartSession())
    }

    const longPressHandlers = useLongPress({
        onLongPress: (point) => {
            haptic.impact('medium')
            setMenuAnchorPoint(point)
            setMenuOpen(true)
        },
        onClick: () => {
            if (!menuOpen) {
                onSelect(s.id)
            }
        },
        threshold: 500
    })

    const sessionName = getSessionTitle(s)
    const attention = useMemo(
        () => classifyVisibleSessionAttention(s, {
            selected,
            lastSeenAt: getSessionLastSeenAt(s.id),
            manualUnreadAt: getSessionManualUnreadAt(s.id),
            detailed: showDetailedStatus,
        }),
        [s, selected, showDetailedStatus, lastSeenVersion]
    )
    const hasScheduleTooltip = showDetailedStatus && s.futureScheduledMessageCount > 0
    const { attentionId, scheduleId, describedBy } = useSessionRowTooltipIds(
        Boolean(attention),
        hasScheduleTooltip
    )
    return (
        <>
            <button
                type="button"
                {...longPressHandlers}
                data-session-scroll-anchor
                className={`session-list-item group/session-row flex w-full flex-col gap-1 py-2 pl-2.5 pr-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)] select-none rounded-lg ${selected ? 'bg-[var(--app-secondary-bg)]' : ''}`}
                style={{ WebkitTouchCallout: 'none' }}
                aria-current={selected ? 'page' : undefined}
                aria-describedby={describedBy}
            >
                <SessionRowSummary
                    session={s}
                    showPath={showPath}
                    showDetailedStatus={showDetailedStatus}
                    selected={selected}
                    nestedTooltips
                    attentionTooltipId={attentionId}
                    lastSeenVersion={lastSeenVersion}
                    scheduleTooltipId={scheduleId}
                    inRunningSection={inRunningSection}
                    projectLabel={projectLabel}
                    projectPath={projectLabel ? getSessionProjectDirectory(s) : undefined}
                    machineLabel={inRunningSection ? undefined : machineLabel}
                    branchLabel={gitBranch}
                    activityTimeBasis={activityTimeBasis}
                />
            </button>

            <SessionActionMenu
                isOpen={menuOpen}
                onClose={() => setMenuOpen(false)}
                sessionId={s.id}
                sessionTitle={sessionName}
                sessionActive={s.active}
                sessionPinned={Boolean(s.pinned)}
                sessionGlobalPinned={Boolean(s.globalPinned)}
                currentContext={props.currentContext}
                onSetContext={props.onSetContext}
                onSetPinMode={(mode) => void handleSetPinMode(mode)}
                onRename={() => setRenameOpen(true)}
                onExport={() => setExportOpen(true)}
                onMarkUnread={() => markSessionUnread(s.id, getSessionUnreadActivityAt(s))}
                onContinueInFolder={onContinueInFolder ? () => onContinueInFolder(s) : undefined}
                onRestart={cursorReopenDisabledReason ? undefined : () => setRestartOpen(true)}
                onArchive={() => setArchiveOpen(true)}
                onReopen={cursorReopenDisabledReason ? undefined : handleReopen}
                reopenDisabledReason={cursorReopenDisabledReason}
                reopenHint={cursorReopenUnverifiedHint}
                onDelete={() => setDeleteOpen(true)}
                anchorPoint={menuAnchorPoint}
            />

            {reopenError ? (
                <ConfirmDialog
                    isOpen={true}
                    onClose={() => setReopenError(null)}
                    title={t('dialog.reopen.errorTitle')}
                    description={reopenError}
                    confirmLabel={t('dialog.reopen.dismiss')}
                    confirmingLabel={t('dialog.reopen.dismiss')}
                    onConfirm={async () => setReopenError(null)}
                    isPending={false}
                    centerTitle
                />
            ) : null}

            {renameOpen ? (
                <RenameSessionDialog
                    isOpen={true}
                    onClose={() => setRenameOpen(false)}
                    currentName={sessionName}
                    onRename={renameSession}
                    onSuggestTitle={api && titleSuggestionAvailable ? suggestSessionTitle : undefined}
                    onUpdateSummary={api && titleSuggestionAvailable ? updateSessionSummary : undefined}
                    isPending={isPending}
                />
            ) : null}

            {exportOpen ? (
                <SessionExportDialog
                    isOpen={true}
                    onClose={() => setExportOpen(false)}
                    sessionId={s.id}
                    api={api}
                />
            ) : null}

            {archiveOpen ? (
                <ConfirmDialog
                    isOpen={true}
                    onClose={() => setArchiveOpen(false)}
                    title={t('dialog.archive.title')}
                    description={t('dialog.archive.description', { name: sessionName })}
                    confirmLabel={t('dialog.archive.confirm')}
                    confirmingLabel={t('dialog.archive.confirming')}
                    onConfirm={archiveSession}
                    isPending={isPending}
                    destructive
                    centerTitle
                />
            ) : null}

            {restartOpen ? (
                <ConfirmDialog
                    isOpen={true}
                    onClose={() => setRestartOpen(false)}
                    title={t('dialog.restart.title')}
                    description={t('dialog.restart.description', { name: sessionName })}
                    confirmLabel={t('dialog.restart.confirm')}
                    confirmingLabel={t('dialog.restart.confirming')}
                    onConfirm={handleRestart}
                    isPending={isPending}
                    centerTitle
                />
            ) : null}

            {deleteOpen ? (
                <ConfirmDialog
                    isOpen={true}
                    onClose={() => setDeleteOpen(false)}
                    title={t('dialog.delete.title')}
                    description={t('dialog.delete.description', { name: sessionName })}
                    confirmLabel={t('dialog.delete.confirm')}
                    confirmingLabel={t('dialog.delete.confirming')}
                    onConfirm={deleteSession}
                    isPending={isPending}
                    destructive
                    centerTitle
                />
            ) : null}
        </>
    )
}

type PullToRefreshState = 'idle' | 'pulling' | 'ready'

const PULL_REFRESH_FEEDBACK_PX = 16
const PULL_REFRESH_TRIGGER_PX = 64

export function getPullToRefreshState(distancePx: number): PullToRefreshState {
    if (distancePx >= PULL_REFRESH_TRIGGER_PX) {
        return 'ready'
    }
    if (distancePx >= PULL_REFRESH_FEEDBACK_PX) {
        return 'pulling'
    }
    return 'idle'
}

export function getPullRefreshIndicatorRotation(state: PullToRefreshState): number {
    return state === 'ready' ? 180 : 0
}

function PullRefreshIcon(props: { rotation: number }) {
    return (
        <svg
            aria-hidden="true"
            className="h-4 w-4 shrink-0 transition-transform duration-200"
            viewBox="0 0 24 24"
            fill="none"
            style={{ transform: `rotate(${props.rotation}deg)` }}
        >
            <path d="M12 5v14M6 13l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    )
}

export function SessionList(props: {
    sessions: SessionSummary[]
    onSelect: (sessionId: string) => void
    onNewSession: () => void
    onNewSessionInDirectory?: (args: { machineId: string | null; directory: string }) => void
    onBrowse?: () => void
    onContinueInFolder?: (session: SessionSummary) => void
    onRefresh: () => Promise<unknown> | void
    isLoading: boolean
    renderHeader?: boolean
    headerActions?: React.ReactNode
    api: ApiClient | null
    titleSuggestionAvailable?: boolean
    machineLabelsById?: Record<string, string>
    machinesById?: Record<string, Machine>
    selectedSessionId?: string | null
}) {
    const { t } = useTranslation()
    const {
        renderHeader = true,
        api,
        titleSuggestionAvailable = false,
        selectedSessionId,
        machineLabelsById = {},
        machinesById = {},
        onNewSessionInDirectory
    } = props
    const { sessionPreviewLimit } = useSessionPreviewLimit()
    const { sessionListStatusMode } = useSessionListStatusMode()
    const { showActiveSessionsOnly } = useShowActiveSessionsOnly()
    const lastSeenVersion = useSessionLastSeenVersion()
    // Transient unread lens — not a Settings preference. Cleared on reload; rows drop as they're seen.
    // (The fork removed the header "unread only" filter; unread state still
    // drives dots and mark-all-read below.)
    const { pinInProgressSessions } = usePinInProgressSessions()
    const { machineFilter, setMachineFilter } = useSessionListMachineFilter()
    const showDetailedStatus = sessionListStatusMode === 'detailed'
    const [searchQuery, setSearchQuery] = useState('')
    const [searchExpanded, setSearchExpanded] = useState(false)
    const [customStart, setCustomStart] = useState('')
    const [customEnd, setCustomEnd] = useState('')
    const [markAllReadOpen, setMarkAllReadOpen] = useState(false)
    const [projectMenu, setProjectMenu] = useState<ProjectMenuState | null>(null)
    const [projectDeleteTarget, setProjectDeleteTarget] = useState<ProjectMenuState | null>(null)
    const [projectDeletePending, setProjectDeletePending] = useState(false)
    const [, setCodexImportedSessionsVersion] = useState(0)
    const normalizedQuery = normalizeSearch(searchQuery)
    const timeRange = getSessionTimeRange(customStart, customEnd)
    const isFiltering = normalizedQuery.length > 0 || timeRange !== null

    const openProjectMenu = (
        group: SessionGroup,
        title: string,
        point: { x: number; y: number }
    ) => {
        setProjectMenu({
            key: group.key,
            title,
            directory: group.directory,
            sessions: props.sessions.filter((session) => getSessionProjectKey(session) === group.key),
            anchorPoint: point,
        })
    }

    const deleteProjectSessions = async () => {
        if (!api || !projectDeleteTarget) {
            throw new Error(t('dialog.error.default'))
        }
        setProjectDeletePending(true)
        try {
            const activeSessions = projectDeleteTarget.sessions.filter((session) => session.active)
            await Promise.all(activeSessions.map((session) => api.archiveSession(session.id)))
            await Promise.all(projectDeleteTarget.sessions.map((session) => api.deleteSession(session.id)))
            await props.onRefresh()
        } finally {
            setProjectDeletePending(false)
        }
    }

    useEffect(() => {
        // 中文注释：监听导入标记变化，让列表在“导入完成”或“用户已在 Hapi 中继续会话”后立即刷新时间文案。
        return subscribeCodexImportedSessions(() => {
            setCodexImportedSessionsVersion((value) => value + 1)
        })
    }, [])

    const resolveMachineLabel = (machineId: string | null): string => {
        if (machineId && machineLabelsById[machineId]) {
            return machineLabelsById[machineId]
        }
        if (machineId) {
            return machineId.slice(0, 8)
        }
        return t('machine.unknown')
    }

    const sidebarSessions = useMemo(
        () => prepareSidebarSessions(props.sessions, selectedSessionId),
        [props.sessions, selectedSessionId]
    )
    const projectDisplayNames = useMemo(
        () => getPathDisplayNames(sidebarSessions.map(getSessionProjectDirectory)),
        [sidebarSessions]
    )
    const getProjectDisplayName = (session: SessionSummary): string => {
        const path = getSessionProjectDirectory(session)
        return projectDisplayNames.get(path) ?? getPathDisplayName(path)
    }
    const readableSessions = useMemo(
        () => props.sessions.filter(session => shouldShowSessionInSidebar(session, selectedSessionId)),
        [props.sessions, selectedSessionId]
    )
    const hubContextSync = useSessionContextHubSync()

    const messageSearchSessionTitles = useMemo(() => {
        const titles = new Map<string, string>()
        for (const session of props.sessions) {
            titles.set(session.id, getSessionTitle(session))
        }
        return titles
    }, [props.sessions])

    const {
        activeContext,
        setActiveContext,
        projectOverrides,
        setProjectContextOverride,
        sessionOverrides,
        setSessionContextOverride,
        workAliases,
        contextOptions,
    } = useSessionContextFilter(hubContextSync)

    const contextStats = useMemo(
        () => computeContextStats(sidebarSessions, contextOptions),
        [sidebarSessions, contextOptions, lastSeenVersion]
    )

    const contextFilteredSessions = useMemo(() => {
        if (activeContext === 'all') return sidebarSessions
        return sidebarSessions.filter(
            (session) => resolveSessionContext(session, contextOptions) === activeContext
        )
    }, [sidebarSessions, activeContext, contextOptions])

    const allSessions = useMemo(
        () => showActiveSessionsOnly
            ? filterActiveSessionsOnly(contextFilteredSessions, selectedSessionId)
            : contextFilteredSessions,
        [contextFilteredSessions, selectedSessionId, showActiveSessionsOnly]
    )
    const unreadSessionCount = useMemo(
        () => getUnreadSessionCount(readableSessions),
        [lastSeenVersion, readableSessions]
    )
    const sessionActivityDates = useMemo(
        () => new Set(sidebarSessions.map(session => formatDateValue(new Date(session.updatedAt)))),
        [sidebarSessions]
    )
    const hasTextQuery = normalizedQuery.length > 0
    const [searchResultSelection, setSearchResultSelection] = useState<'chats' | 'messages' | null>(null)
    // Lifted here so the messages tab badge shows the match count while the
    // chats tab is the active one.
    const messageSearchState = useMessageSearch(api, normalizedQuery)
    const timeScopedSessions = useMemo(
        () => timeRange === null
            ? allSessions
            : allSessions.filter(session => sessionMatchesTimeRange(session, timeRange)),
        [allSessions, timeRange?.start, timeRange?.end] // eslint-disable-line react-hooks/exhaustive-deps
    )
    const projectTimeScopedSessions = useMemo(
        () => timeRange === null
            ? contextFilteredSessions
            : contextFilteredSessions.filter(session => sessionMatchesTimeRange(session, timeRange)),
        [contextFilteredSessions, timeRange?.start, timeRange?.end] // eslint-disable-line react-hooks/exhaustive-deps
    )
    const searchScoreIndex = useMemo(
        () => hasTextQuery
            ? buildSessionSearchScoreIndex(projectTimeScopedSessions, normalizedQuery, resolveMachineLabel)
            : null,
        [hasTextQuery, projectTimeScopedSessions, normalizedQuery, machineLabelsById] // eslint-disable-line react-hooks/exhaustive-deps
    )
    const chatsHaveNoMatches = normalizedQuery.length >= 2 && searchScoreIndex?.matchedIds.size === 0
    const searchResultTabOrder: ('chats' | 'messages')[] = chatsHaveNoMatches
        ? ['messages', 'chats']
        : ['chats', 'messages']
    const searchResultTab = searchResultSelection ?? (chatsHaveNoMatches ? 'messages' : 'chats')
    const showSessionSections = !hasTextQuery || searchResultTab === 'chats'
    const visibleSessions = useMemo(
        () => {
            if (!isFiltering) return allSessions
            const matched = hasTextQuery && searchScoreIndex
                ? timeScopedSessions.filter(session => searchScoreIndex.matchedIds.has(session.id))
                : timeScopedSessions.filter(session => (
                    sessionMatchesQuery(
                        session,
                        normalizedQuery,
                        resolveMachineLabel(session.metadata?.machineId ?? null)
                    )
                ))
            if (hasTextQuery && searchScoreIndex) {
                return sortSessionsBySearchRelevance(matched, searchScoreIndex)
            }
            return matched
        },
        [allSessions, hasTextQuery, isFiltering, normalizedQuery, searchScoreIndex, timeScopedSessions, machineLabelsById] // eslint-disable-line react-hooks/exhaustive-deps
    )
    const allGroups = useMemo(
        () => groupSessionsByDirectory(contextFilteredSessions, projectDisplayNames),
        [projectDisplayNames, contextFilteredSessions]
    )
    const machineFilters = useMemo(
        () => groupByMachine(allGroups, resolveMachineLabel),
        [allGroups, machineLabelsById] // eslint-disable-line react-hooks/exhaustive-deps
    )
    const machineFilterItems = useMemo(
        () => machineFilters.map((mg) => {
            const machine = mg.machineId ? machinesById[mg.machineId] : undefined
            return {
                id: mg.machineId ?? UNKNOWN_MACHINE_ID,
                label: mg.label,
                sessionCount: mg.totalSessions,
                healthPresentation: presentMachineHealth(
                    machine?.health,
                    getMachinePlatform(machine)
                )
            }
        }),
        [machineFilters, machinesById]
    )
    const showMachineFilterBar = machineFilters.length >= 2
    // A persisted filter whose machine no longer has sessions falls back to
    // "All"; with at most one machine the bar is hidden and never filters.
    const activeMachineFilter = showMachineFilterBar && machineFilter !== null
        && machineFilters.some(mg => (mg.machineId ?? UNKNOWN_MACHINE_ID) === machineFilter)
        ? machineFilter
        : null
    const machineFilteredSessions = useMemo(
        () => activeMachineFilter === null
            ? visibleSessions
            : visibleSessions.filter(session =>
                (session.metadata?.machineId ?? UNKNOWN_MACHINE_ID) === activeMachineFilter
            ),
        [visibleSessions, activeMachineFilter]
    )
    // Project launch points stay visible when inactive session rows are hidden.
    // Search/date/machine lenses still scope them consistently with the
    // visible list; only the active-only preference is deliberately ignored.
    const projectHeaderSessions = useMemo(() => {
        const searched = isFiltering
            ? hasTextQuery && searchScoreIndex
                ? sortSessionsBySearchRelevance(
                    projectTimeScopedSessions.filter((session) => searchScoreIndex.matchedIds.has(session.id)),
                    searchScoreIndex
                )
                : projectTimeScopedSessions
            : contextFilteredSessions
        return activeMachineFilter === null
            ? searched
            : searched.filter((session) => (
                (session.metadata?.machineId ?? UNKNOWN_MACHINE_ID) === activeMachineFilter
            ))
    }, [
        activeMachineFilter,
        contextFilteredSessions,
        hasTextQuery,
        isFiltering,
        machineLabelsById,
        normalizedQuery,
        projectTimeScopedSessions,
        searchScoreIndex,
        timeRange?.end,
        timeRange?.start,
    ]) // eslint-disable-line react-hooks/exhaustive-deps
    const globalPinnedSessions = useMemo(() => {
        const pinned = sortSessionsByUserActivity(
            machineFilteredSessions.filter((session) => Boolean(session.globalPinned))
        )
        return hasTextQuery && searchScoreIndex
            ? sortSessionsBySearchRelevancePreservingForkOrder(pinned, searchScoreIndex)
            : pinned
    }, [hasTextQuery, machineFilteredSessions, searchScoreIndex])
    const workingSessions = useMemo(() => {
        if (!pinInProgressSessions) {
            return []
        }
        const working = sortSessionsByNewestUserActivity(
            machineFilteredSessions.filter((session) => (
                !session.globalPinned && isWorkingSession(session)
            ))
        )
        return hasTextQuery && searchScoreIndex
            ? sortSessionsBySearchRelevancePreservingForkOrder(working, searchScoreIndex)
            : working
    }, [hasTextQuery, machineFilteredSessions, pinInProgressSessions, searchScoreIndex])
    const activeSessions = useMemo(() => {
        if (!pinInProgressSessions) {
            return []
        }
        const active = sortActiveSessions(
            machineFilteredSessions.filter((session) => (
                session.active
                && !session.globalPinned
                && !isWorkingSession(session)
                && session.metadata?.lifecycleState !== SESSION_LIFECYCLE_IDLE
            ))
        )
        return hasTextQuery && searchScoreIndex
            ? sortSessionsBySearchRelevancePreservingForkOrder(active, searchScoreIndex)
            : active
    }, [hasTextQuery, machineFilteredSessions, pinInProgressSessions, searchScoreIndex])
    const idleSessions = useMemo(() => {
        if (!pinInProgressSessions) {
            return []
        }
        const idle = sortSessionsByNewestAgentActivity(
            machineFilteredSessions.filter((session) => (
                session.active
                && !session.globalPinned
                && !isWorkingSession(session)
                && session.metadata?.lifecycleState === SESSION_LIFECYCLE_IDLE
            ))
        )
        return hasTextQuery && searchScoreIndex
            ? sortSessionsBySearchRelevancePreservingForkOrder(idle, searchScoreIndex)
            : idle
    }, [hasTextQuery, machineFilteredSessions, pinInProgressSessions, searchScoreIndex])
    const recentSessions = useMemo(() => sortSessionsByNewestAgentActivity(
        projectHeaderSessions.filter((session) => !session.active && !session.globalPinned)
    ), [projectHeaderSessions])
    const allDirectoryGroups = useMemo(
        () => groupSessionsByDirectory(
            projectHeaderSessions.filter((session) => !session.globalPinned),
            projectDisplayNames
        ),
        [projectDisplayNames, projectHeaderSessions]
    )
    const groups = useMemo(() => {
        const grouped = allDirectoryGroups.flatMap((group) => {
            const sessions = pinInProgressSessions
                ? group.sessions.filter((session) => !isPinnedInProgressSession(session))
                : group.sessions
            return sessions.length > 0 ? [{ ...group, sessions }] : []
        })
        return hasTextQuery && searchScoreIndex
            ? rankSessionGroupsBySearchRelevancePreservingForkOrder(grouped, searchScoreIndex)
            : grouped
    }, [allDirectoryGroups, hasTextQuery, pinInProgressSessions, searchScoreIndex])
    const [collapseOverrides, setCollapseOverrides] = useState<Map<string, boolean>>(
        () => new Map()
    )
    const [pinnedSectionCollapsed, setPinnedSectionCollapsed] = useState(false)
    const [recentSectionCollapsed, setRecentSectionCollapsed] = useState(true)
    const [recentVisibleCount, setRecentVisibleCount] = useState(RECENT_SESSION_BATCH_SIZE)
    const autoExpandedSelectedSessionKeyRef = useRef<string | null>(null)
    const isGroupCollapsed = (group: SessionGroup): boolean => {
        if (isFiltering) return false
        const override = collapseOverrides.get(group.key)
        if (override !== undefined) return override
        const hasSelectedSession = selectedSessionId
            ? group.sessions.some(session => session.id === selectedSessionId)
            : false
        return !hasSelectedSession
    }

    const toggleGroup = (groupKey: string, isCollapsed: boolean) => {
        setCollapseOverrides(prev => {
            const next = new Map(prev)
            next.set(groupKey, !isCollapsed)
            return next
        })
    }

    // Per-group reveal cap for paginated session previews. Absent = the configured
    // preview limit; expand/collapse controls move the cap by one preview-sized batch.
    const [sessionVisibleCounts, setSessionVisibleCounts] = useState<Map<string, number>>(
        () => new Map()
    )

    const getGroupVisibleCount = (group: SessionGroup): number => {
        return sessionVisibleCounts.get(group.key) ?? sessionPreviewLimit
    }

    const showMoreSessions = (group: SessionGroup) => {
        setSessionVisibleCounts(prev => {
            const next = new Map(prev)
            const currentLimit = Math.min(
                prev.get(group.key) ?? sessionPreviewLimit,
                group.sessions.length
            )
            const currentVisibleCount = getVisibleSessionPreview(group.sessions, {
                selectedSessionId,
                limit: currentLimit
            }).length
            next.set(group.key, getNextSessionVisibleCount(
                Math.max(currentLimit, currentVisibleCount),
                sessionPreviewLimit,
                group.sessions.length
            ))
            return next
        })
    }

    const showFewerSessions = (group: SessionGroup) => {
        setSessionVisibleCounts(prev => {
            const next = new Map(prev)
            const current = Math.min(
                prev.get(group.key) ?? sessionPreviewLimit,
                group.sessions.length
            )
            const previous = getPreviousSessionVisibleCount(current, sessionPreviewLimit)
            if (previous <= sessionPreviewLimit) {
                next.delete(group.key)
            } else {
                next.set(group.key, previous)
            }
            return next
        })
    }

    const getVisibleGroupSessions = (group: SessionGroup): SessionSummary[] => {
        return getVisibleSessionPreview(
            group.sessions,
            {
                selectedSessionId,
                limit: getGroupVisibleCount(group)
            }
        )
    }

    const renderSessionSection = ({
        sectionKey,
        titleKey,
        collapsed,
        onToggle,
        sessions,
        activityTimeBasis,
        collapsible = true,
        statusColorClass = 'bg-[var(--app-badge-success-text)]',
    }: {
        sectionKey: string
        titleKey: string
        collapsed: boolean
        onToggle?: () => void
        sessions: SessionSummary[]
        activityTimeBasis: SessionActivityTimeBasis
        collapsible?: boolean
        statusColorClass?: string
    }) => {
        if (sessions.length === 0) {
            return null
        }
        return (
            <div key={sectionKey}>
                <div
                    className={cn(
                        'group/running flex min-w-0 w-full select-none items-center gap-2 rounded-lg py-1.5 pl-2 pr-2 transition-colors',
                        collapsible && 'cursor-pointer hover:bg-[var(--app-secondary-bg)]'
                    )}
                    role={collapsible ? 'button' : undefined}
                    tabIndex={collapsible ? 0 : undefined}
                    aria-expanded={collapsible ? (!collapsed || isFiltering) : undefined}
                    onClick={collapsible ? onToggle : undefined}
                    onKeyDown={collapsible ? (event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault()
                            onToggle?.()
                        }
                    } : undefined}
                    title={t(titleKey)}
                >
                    {collapsible ? (
                        <ChevronIcon className="h-3.5 w-3.5 text-[var(--app-hint)] shrink-0" collapsed={collapsed && !isFiltering} />
                    ) : (
                        <ChevronIcon className="h-3.5 w-3.5 text-[var(--app-hint)] shrink-0" collapsed={false} />
                    )}
                    <span className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center" aria-hidden="true">
                        <span className={cn('h-1.5 w-1.5 rounded-full', statusColorClass)} />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                        {t(titleKey)}
                    </span>
                    <span className="shrink-0 text-[11px] tabular-nums text-[var(--app-hint)]">
                        ({sessions.length})
                    </span>
                </div>
                <div className="collapsible-panel" data-open={(!collapsible || !collapsed || isFiltering) || undefined}>
                    <div className="collapsible-inner">
                    <div className="flex flex-col gap-0.5 ml-3 pl-1 py-1">
                        {sessions.map((s) => (
                            <SessionItem
                                key={s.id}
                                session={s}
                                onSelect={props.onSelect}
                                onContinueInFolder={props.onContinueInFolder}
                                showPath={false}
                                api={api}
                                titleSuggestionAvailable={titleSuggestionAvailable}
                                selected={s.id === selectedSessionId}
                                showDetailedStatus={showDetailedStatus}
                                inRunningSection
                                projectLabel={getProjectDisplayName(s)}
                                machineLabel={resolveMachineLabel(s.metadata?.machineId ?? null)}
                                activityTimeBasis={activityTimeBasis}
                                lastSeenVersion={lastSeenVersion}
                                currentContext={resolveSessionContext(s, contextOptions)}
                                onSetContext={(ctx) => setSessionContextOverride(s.id, ctx)}
                            />
                        ))}
                    </div>
                    </div>
                </div>
            </div>
        )
    }

    const renderRecentSessions = () => {
        // Search/date/unread results already render in their project groups.
        // Keep this shortcut out of filtered views to avoid duplicate results.
        if (recentSessions.length === 0 || isFiltering) return null
        const visibleRecentSessions = recentSessions.slice(0, recentVisibleCount)
        const hiddenCount = recentSessions.length - visibleRecentSessions.length
        const expandCount = Math.min(RECENT_SESSION_BATCH_SIZE, hiddenCount)

        return (
            <div key="recent-section">
                <div
                    className="group/recent flex min-w-0 w-full select-none cursor-pointer items-center gap-2 rounded-lg py-1.5 pl-2 pr-2 transition-colors hover:bg-[var(--app-secondary-bg)]"
                    role="button"
                    tabIndex={0}
                    aria-expanded={!recentSectionCollapsed}
                    aria-label={t('sessions.recentToggle')}
                    onClick={() => setRecentSectionCollapsed((value) => !value)}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault()
                            setRecentSectionCollapsed((value) => !value)
                        }
                    }}
                    title={t('sessions.recentSection')}
                >
                    <ChevronIcon className="h-3.5 w-3.5 text-[var(--app-hint)] shrink-0" collapsed={recentSectionCollapsed} />
                    <span className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center" aria-hidden="true">
                        <span
                            data-testid="recent-session-indicator"
                            className="h-1.5 w-1.5 rounded-full bg-[var(--app-badge-warning-text)]"
                        />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                        {t('sessions.recentSection')}
                    </span>
                    <span className="shrink-0 text-[11px] tabular-nums text-[var(--app-hint)]">
                        ({recentSessions.length})
                    </span>
                </div>
                <div className="collapsible-panel" data-open={!recentSectionCollapsed || undefined}>
                    <div className="collapsible-inner">
                    {!recentSectionCollapsed ? (
                        <div className="flex flex-col gap-0.5 ml-3 pl-1 py-1">
                            {visibleRecentSessions.map((session) => (
                                <SessionItem
                                    key={session.id}
                                    session={session}
                                    onSelect={props.onSelect}
                                    onContinueInFolder={props.onContinueInFolder}
                                    showPath={false}
                                    api={api}
                                    titleSuggestionAvailable={titleSuggestionAvailable}
                                    selected={session.id === selectedSessionId}
                                    showDetailedStatus={showDetailedStatus}
                                    inRunningSection
                                    projectLabel={getProjectDisplayName(session)}
                                    machineLabel={resolveMachineLabel(session.metadata?.machineId ?? null)}
                                    activityTimeBasis="agent"
                                    lastSeenVersion={lastSeenVersion}
                                    currentContext={resolveSessionContext(session, contextOptions)}
                                    onSetContext={(ctx) => setSessionContextOverride(session.id, ctx)}
                                />
                            ))}
                            {hiddenCount > 0 ? (
                                <button
                                    type="button"
                                    onClick={() => setRecentVisibleCount((count) => Math.min(count + RECENT_SESSION_BATCH_SIZE, recentSessions.length))}
                                    className="ml-2.5 mr-2 my-1 flex items-center justify-center gap-1 rounded-md border border-dashed border-[var(--app-border)] px-2 py-1 text-center text-xs text-[var(--app-hint)] transition-colors hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)]"
                                >
                                    <SessionPreviewArrowIcon direction="down" className="h-3 w-3 shrink-0" />
                                    {t('sessions.group.expand', { n: expandCount })}
                                </button>
                            ) : null}
                        </div>
                    ) : null}
                    </div>
                </div>
            </div>
        )
    }

    const renderDirectoryGroup = (group: SessionGroup) => {
        const isCollapsed = isGroupCollapsed(group)
        const visibleGroupSessions = getVisibleGroupSessions(group)
        const hiddenSessionCount = group.sessions.length - visibleGroupSessions.length
        const currentLimit = Math.min(
            getGroupVisibleCount(group),
            group.sessions.length
        )
        const previousLimit = getPreviousSessionVisibleCount(currentLimit, sessionPreviewLimit)
        const previousGroupSessions = getVisibleSessionPreview(group.sessions, {
            selectedSessionId,
            limit: previousLimit
        })
        const collapseCount = visibleGroupSessions.length - previousGroupSessions.length
        const canShowFewerSessions = previousLimit < currentLimit && collapseCount > 0
        const expandCount = Math.min(sessionPreviewLimit, hiddenSessionCount)
        const canStartInGroupDirectory = group.directory !== 'Other'
        // With multiple machines in the unfiltered view, disambiguate
        // same-named directories by suffixing the machine label.
        const groupTitle = showMachineFilterBar && activeMachineFilter === null
            ? `${group.displayName} · ${resolveMachineLabel(group.machineId)}`
            : group.displayName
        return (
            <div key={group.key} data-session-scroll-anchor>
                <div
                    className="group/project sticky top-0 z-10 flex items-center gap-2 bg-[var(--app-bg)] py-1.5 pl-2 pr-2 text-left rounded-lg transition-colors hover:bg-[var(--app-secondary-bg)] cursor-pointer min-w-0 w-full select-none"
                    onClick={() => toggleGroup(group.key, isCollapsed)}
                    onContextMenu={(event) => {
                        event.preventDefault()
                        openProjectMenu(group, groupTitle, {
                            x: event.clientX,
                            y: event.clientY,
                        })
                    }}
                    title={group.directory}
                >
                    <ChevronIcon className="h-3.5 w-3.5 text-[var(--app-hint)] shrink-0" collapsed={isCollapsed} />
                    <span className="font-medium text-sm truncate flex-1">
                        {groupTitle}
                    </span>
                    <CopyPathButton path={group.directory} className="opacity-0 group-hover/project:opacity-100 transition-opacity duration-150" />
                    {onNewSessionInDirectory && canStartInGroupDirectory ? (
                        <button
                            type="button"
                            onClick={(event) => {
                                event.stopPropagation()
                                onNewSessionInDirectory({
                                    machineId: group.machineId,
                                    directory: group.directory
                                })
                            }}
                            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[var(--app-hint)] opacity-70 transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-link)] hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)]"
                            title={t('sessions.group.new')}
                            aria-label={t('sessions.group.new')}
                        >
                            <PlusIcon className="h-3.5 w-3.5" />
                        </button>
                    ) : null}
                    <span className="text-[11px] tabular-nums text-[var(--app-hint)] shrink-0">
                        ({group.sessions.length})
                    </span>
                </div>

                {/* Sessions */}
                <div className="collapsible-panel" data-open={!isCollapsed || undefined}>
                    <div className="collapsible-inner">
                    <div className="flex flex-col gap-0.5 ml-3 pl-1 py-1">
                        {visibleGroupSessions.map((s, index) => (
                            <div key={s.id} className="contents">
                                {shouldShowPinnedDivider(visibleGroupSessions, index) ? (
                                    <div
                                        data-testid="session-pin-divider"
                                        className="ml-2.5 mr-2 my-1 border-t border-[var(--app-border)]"
                                        aria-hidden="true"
                                    />
                                ) : null}
                                <SessionItem
                                    session={s}
                                    onSelect={props.onSelect}
                                    onContinueInFolder={props.onContinueInFolder}
                                    showPath={false}
                                    api={api}
                                    titleSuggestionAvailable={titleSuggestionAvailable}
                                    selected={s.id === selectedSessionId}
                                    showDetailedStatus={showDetailedStatus}
                                    activityTimeBasis="user"
                                    lastSeenVersion={lastSeenVersion}
                                    currentContext={resolveSessionContext(s, contextOptions)}
                                    onSetContext={(ctx) => setSessionContextOverride(s.id, ctx)}
                                />
                            </div>
                        ))}
                        {group.sessions.length > sessionPreviewLimit && (hiddenSessionCount > 0 || canShowFewerSessions) ? (
                            <div className="ml-2.5 mr-2 my-1 flex gap-1.5">
                                {canShowFewerSessions ? (
                                    <button
                                        type="button"
                                        onClick={() => showFewerSessions(group)}
                                        className="flex min-w-0 flex-1 items-center justify-center gap-1 rounded-md border border-dashed border-[var(--app-border)] px-2 py-1 text-center text-xs text-[var(--app-hint)] transition-colors hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)]"
                                    >
                                        <SessionPreviewArrowIcon direction="up" className="h-3 w-3 shrink-0" />
                                        {t('sessions.group.collapse', { n: collapseCount })}
                                    </button>
                                ) : null}
                                {hiddenSessionCount > 0 ? (
                                    <button
                                        type="button"
                                        onClick={() => showMoreSessions(group)}
                                        className="flex min-w-0 flex-1 items-center justify-center gap-1 rounded-md border border-dashed border-[var(--app-border)] px-2 py-1 text-center text-xs text-[var(--app-hint)] transition-colors hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)]"
                                    >
                                        <SessionPreviewArrowIcon direction="down" className="h-3 w-3 shrink-0" />
                                        {t('sessions.group.expand', { n: expandCount })}
                                    </button>
                                ) : null}
                            </div>
                        ) : null}
                    </div>
                    </div>
                </div>
            </div>
        )
    }

    // Auto-expand group containing the selected session only when
    // the selected-session/group pair changes. Without this guard, every live
    // session-list refresh (for example tool-call updates from a running selected
    // session) reopens a path the user just collapsed.
    useEffect(() => {
        if (!selectedSessionId) {
            autoExpandedSelectedSessionKeyRef.current = null
            return
        }

        // Pinned "in progress" sessions are not rendered inside directory
        // groups, so only auto-expand when the selected session actually lives
        // in a visible group. Using `allGroups` here would expand the group
        // below whenever a running session is opened.
        const group = groups.find(g =>
            g.sessions.some(s => s.id === selectedSessionId)
        )
        if (!group) {
            // The selected session is not rendered inside any directory group
            // (e.g. it moved to the pinned "in progress" section). Drop the
            // guard so it auto-expands again when it transitions back into a
            // group later.
            autoExpandedSelectedSessionKeyRef.current = null
            return
        }

        const autoExpandKey = `${selectedSessionId}::${group.key}`
        if (autoExpandedSelectedSessionKeyRef.current === autoExpandKey) return
        autoExpandedSelectedSessionKeyRef.current = autoExpandKey

        setCollapseOverrides(prev => expandSelectedSessionCollapseOverrides(prev, group))
    }, [selectedSessionId, groups])

    // Clean up stale collapse overrides
    useEffect(() => {
        setCollapseOverrides(prev => {
            if (prev.size === 0) return prev
            const next = new Map(prev)
            const knownKeys = new Set<string>()
            for (const g of allGroups) {
                knownKeys.add(g.key)
                knownKeys.add(`sessions::${g.key}`)
            }
            let changed = false
            for (const key of next.keys()) {
                if (!knownKeys.has(key)) {
                    next.delete(key)
                    changed = true
                }
            }
            return changed ? next : prev
        })
    }, [allGroups])

    // Clean up reveal caps for groups that no longer exist.
    useEffect(() => {
        setSessionVisibleCounts(prev => {
            if (prev.size === 0) return prev
            const knownKeys = new Set(allGroups.map(g => g.key))
            const next = new Map(prev)
            let changed = false
            for (const key of next.keys()) {
                if (!knownKeys.has(key)) {
                    next.delete(key)
                    changed = true
                }
            }
            return changed ? next : prev
        })
    }, [allGroups])

    // The search control unmounts when the list empties; reset the expansion so
    // it cannot suppress header actions (or re-expand on its own when sessions
    // return) while no search control is rendered.
    const showSearch = props.sessions.length > 0
    useEffect(() => {
        if (!showSearch) setSearchExpanded(false)
    }, [showSearch])

    const showHeaderRow = showSearch || renderHeader || Boolean(props.headerActions)

    // Pull-to-refresh on the scrollable list. Touch-only gesture mirroring the
    // pull-to-load-older pattern in HappyThread; desktop has no overscroll
    // bounce to make a wheel pull feel right, so it stays on live updates.
    const scrollContainerRef = useRef<HTMLDivElement>(null)
    useTransientScrollbar(scrollContainerRef, 'left')
    const [pullState, setPullState] = useState<PullToRefreshState>('idle')
    const pullStateRef = useRef<PullToRefreshState>('idle')
    const [isRefreshing, setIsRefreshing] = useState(false)
    const isRefreshingRef = useRef(false)
    const onRefreshRef = useRef(props.onRefresh)
    useEffect(() => {
        onRefreshRef.current = props.onRefresh
    }, [props.onRefresh])

    useEffect(() => {
        const container = scrollContainerRef.current
        if (!container) return

        let pullStartY: number | null = null

        const updatePullState = (state: PullToRefreshState) => {
            if (pullStateRef.current === state) {
                return
            }
            pullStateRef.current = state
            setPullState(state)
        }

        const triggerRefresh = () => {
            if (isRefreshingRef.current) {
                return
            }
            isRefreshingRef.current = true
            setIsRefreshing(true)
            void Promise.resolve(onRefreshRef.current()).finally(() => {
                isRefreshingRef.current = false
                setIsRefreshing(false)
            })
        }

        const handleTouchStart = (event: TouchEvent) => {
            updatePullState('idle')
            pullStartY = container.scrollTop <= 0 && !isRefreshingRef.current
                ? event.touches[0]?.clientY ?? null
                : null
        }

        const handleTouchMove = (event: TouchEvent) => {
            if (pullStartY === null) {
                return
            }
            if (container.scrollTop > 0) {
                pullStartY = null
                updatePullState('idle')
                return
            }
            const currentY = event.touches[0]?.clientY
            if (currentY !== undefined) {
                updatePullState(getPullToRefreshState(currentY - pullStartY))
            }
        }

        const handleTouchEnd = () => {
            const shouldRefresh = pullStartY !== null
                && pullStateRef.current === 'ready'
                && container.scrollTop <= 0
            pullStartY = null
            updatePullState('idle')
            if (shouldRefresh) {
                triggerRefresh()
            }
        }

        const handleTouchCancel = () => {
            pullStartY = null
            updatePullState('idle')
        }

        container.addEventListener('touchstart', handleTouchStart, { passive: true })
        container.addEventListener('touchmove', handleTouchMove, { passive: true })
        container.addEventListener('touchend', handleTouchEnd, { passive: true })
        container.addEventListener('touchcancel', handleTouchCancel, { passive: true })
        return () => {
            container.removeEventListener('touchstart', handleTouchStart)
            container.removeEventListener('touchmove', handleTouchMove)
            container.removeEventListener('touchend', handleTouchEnd)
            container.removeEventListener('touchcancel', handleTouchCancel)
        }
    }, [])

    // Horizontal swipes switch the active context tab on touch devices, so a
    // deliberate swipe falls through to tab navigation instead of the
    // browser's back/forward gesture. The tab bar itself is ignored: a swipe
    // there scrolls it natively.
    const activeContextRef = useRef(activeContext)
    useEffect(() => {
        activeContextRef.current = activeContext
    }, [activeContext])

    const stepContextTab = useCallback((step: 1 | -1) => {
        const order = SESSION_CONTEXTS.map((ctx) => ctx.id)
        const index = order.indexOf(activeContextRef.current)
        const next = order[index + step]
        if (!next || next === activeContextRef.current) return
        getPlatform().haptic.selection()
        setActiveContext(next)
    }, [setActiveContext])

    useHorizontalSwipe(scrollContainerRef, {
        onSwipeLeft: () => stepContextTab(1),
        onSwipeRight: () => stepContextTab(-1),
    }, { ignoreSelector: '[role="tablist"]' })

    return (
        <div className="flex min-h-0 w-full flex-1 flex-col">
            <div className="session-list-scrollbar-offset mx-auto w-full max-w-content shrink-0">
            {showHeaderRow ? (
                <div className="flex items-center gap-1 pl-4 pr-2 py-1">
                    {showSearch ? (
                        <SessionListSearch
                            value={searchQuery}
                            onChange={(value) => {
                                setSearchQuery(value)
                                setSearchResultSelection(null)
                            }}
                            customStart={customStart}
                            customEnd={customEnd}
                            sessionActivityDates={sessionActivityDates}
                            onDateRangeChange={(start, end) => {
                                setCustomStart(start)
                                setCustomEnd(end)
                            }}
                            expanded={searchExpanded}
                            onExpandedChange={setSearchExpanded}
                        />
                    ) : null}
                    {!(showSearch && searchExpanded) ? (
                        <>
                            <div className="flex-1" />
                            {showMachineFilterBar ? (
                                <MachineFilterMenu
                                    machines={machineFilterItems}
                                    totalCount={contextFilteredSessions.length}
                                    value={activeMachineFilter}
                                    onChange={setMachineFilter}
                                />
                            ) : null}
                            {unreadSessionCount > 0 ? (
                                <button
                                    type="button"
                                    onClick={() => setMarkAllReadOpen(true)}
                                    title={t('sessions.markAllRead.button', { count: unreadSessionCount })}
                                    aria-label={t('sessions.markAllRead.button', { count: unreadSessionCount })}
                                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[var(--app-hint)] transition-colors hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)]"
                                >
                                    <MarkAllReadIcon className="h-5 w-5" />
                                </button>
                            ) : null}
                            {renderHeader ? (
                                <button
                                    type="button"
                                    onClick={props.onNewSession}
                                    className="session-list-new-button flex h-9 w-9 items-center justify-center rounded-full text-[var(--app-link)] transition-colors"
                                    title={t('sessions.new')}
                                >
                                    <PlusIcon className="h-5 w-5" />
                                </button>
                            ) : null}
                            {props.headerActions}
                        </>
                    ) : null}
                </div>
            ) : null}

            <ContextTabBar
                activeContext={activeContext}
                onSelectContext={setActiveContext}
                stats={contextStats}
            />

            {showMachineFilterBar ? (
                <MachineFilterBar
                    machines={machineFilterItems}
                    totalCount={contextFilteredSessions.length}
                    value={activeMachineFilter}
                    onChange={setMachineFilter}
                />
            ) : null}
            </div>

            <div className="relative flex min-h-0 flex-1 flex-col">
            {isRefreshing || pullState !== 'idle' || props.isLoading ? (
                <div
                    role="status"
                    aria-live="polite"
                    className="pointer-events-none absolute left-1/2 top-3 z-20 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-[var(--app-border)] bg-[var(--app-bg)]/90 px-2.5 py-1 text-xs text-[var(--app-hint)] shadow-sm backdrop-blur"
                >
                    {isRefreshing || props.isLoading
                        ? <Spinner size="sm" label={null} className="text-current" />
                        : <PullRefreshIcon rotation={getPullRefreshIndicatorRotation(pullState)} />}
                    <span>
                        {isRefreshing
                            ? t('sessions.refresh.refreshing')
                            : props.isLoading
                                ? t('misc.loading')
                                : pullState === 'ready'
                                    ? t('sessions.refresh.release')
                                    : t('sessions.refresh.pull')}
                    </span>
                </div>
            ) : null}
            <div ref={scrollContainerRef} className="app-scroll-y session-list-scrollbar-left scrollbar-auto-hide min-h-0 flex-1">
            <SessionListScrollAnchor sessions={props.sessions} className="mx-auto flex w-full max-w-content flex-col gap-1 pl-1.5 pr-2 pb-2">
                {props.sessions.length === 0 && !props.isLoading ? (
                    <SessionsEmptyState
                        onNewSession={props.onNewSession}
                        onBrowse={props.onBrowse}
                    />
                ) : null}

                {hasTextQuery ? (
                    <div
                        className="mx-3 mb-1 flex items-center gap-1 rounded-lg bg-[var(--app-secondary-bg)] p-0.5"
                        role="tablist"
                        aria-label={t('sessions.messageSearch.title')}
                        data-testid="search-results-tabs"
                    >
                        {searchResultTabOrder.map((tab) => (
                            <button
                                key={tab}
                                type="button"
                                role="tab"
                                aria-selected={searchResultTab === tab}
                                onClick={() => setSearchResultSelection(tab)}
                                className={cn(
                                    'flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)]',
                                    searchResultTab === tab
                                        ? 'bg-[var(--app-bg)] font-medium text-[var(--app-fg)]'
                                        : 'text-[var(--app-hint)] hover:text-[var(--app-fg)]'
                                )}
                            >
                                <span className="min-w-0 truncate">
                                    {t(tab === 'chats' ? 'sessions.search.tabChats' : 'sessions.search.tabMessages')}
                                </span>
                                {tab === 'chats' && searchScoreIndex ? (
                                    <span className="shrink-0 text-[11px] tabular-nums opacity-70">
                                        ({searchScoreIndex.matchedIds.size})
                                    </span>
                                ) : tab === 'messages' && messageSearchState.response ? (
                                    <span className="shrink-0 text-[11px] tabular-nums opacity-70">
                                        ({messageSearchState.response.total})
                                    </span>
                                ) : null}
                            </button>
                        ))}
                    </div>
                ) : null}

                {showSessionSections && props.sessions.length > 0 && (isFiltering || activeMachineFilter !== null || activeContext !== 'all') && groups.length === 0 && workingSessions.length === 0 && activeSessions.length === 0 && recentSessions.length === 0 && globalPinnedSessions.length === 0 ? (
                    <div className="px-4 py-8 text-center text-sm text-[var(--app-hint)]">
                        {t('sessions.search.noResults')}
                    </div>
                ) : null}

                {showSessionSections && globalPinnedSessions.length > 0 ? (
                    <div key="pinned-section">
                        <div
                            className="group/pinned flex min-w-0 w-full select-none cursor-pointer items-center gap-2 rounded-lg py-1.5 pl-2 pr-2 transition-colors hover:bg-[var(--app-secondary-bg)]"
                            role="button"
                            tabIndex={0}
                            aria-expanded={!pinnedSectionCollapsed || isFiltering}
                            onClick={() => setPinnedSectionCollapsed((value) => !value)}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter' || event.key === ' ') {
                                    event.preventDefault()
                                    setPinnedSectionCollapsed((value) => !value)
                                }
                            }}
                            title={t('sessions.pinnedSection')}
                        >
                            <ChevronIcon className="h-3.5 w-3.5 text-[var(--app-hint)] shrink-0" collapsed={pinnedSectionCollapsed && !isFiltering} />
                            <span className="inline-flex min-w-0 items-center gap-1">
                                <span className="min-w-0 truncate text-sm font-medium">
                                    {t('sessions.pinnedSection')}
                                </span>
                                <PinnedSectionIcon className="h-3.5 w-3.5 shrink-0 -translate-y-px text-[var(--app-hint)]" />
                            </span>
                            <span className="min-w-0 flex-1" aria-hidden="true" />
                            <span className="shrink-0 text-[11px] tabular-nums text-[var(--app-hint)]">
                                ({globalPinnedSessions.length})
                            </span>
                        </div>
                        <div className="collapsible-panel" data-open={(!pinnedSectionCollapsed || isFiltering) || undefined}>
                            <div className="collapsible-inner">
                                <div className="flex flex-col gap-0.5 ml-3 pl-1 py-1">
                                    {globalPinnedSessions.map((s) => (
                                        <SessionItem
                                            key={s.id}
                                            session={s}
                                            onSelect={props.onSelect}
                                            onContinueInFolder={props.onContinueInFolder}
                                            showPath={false}
                                            api={api}
                                            titleSuggestionAvailable={titleSuggestionAvailable}
                                            selected={s.id === selectedSessionId}
                                            showDetailedStatus={showDetailedStatus}
                                            inRunningSection
                                            projectLabel={getProjectDisplayName(s)}
                                            machineLabel={resolveMachineLabel(s.metadata?.machineId ?? null)}
                                            activityTimeBasis="user"
                                            lastSeenVersion={lastSeenVersion}
                                            currentContext={resolveSessionContext(s, contextOptions)}
                                            onSetContext={(ctx) => setSessionContextOverride(s.id, ctx)}
                                        />
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                ) : null}

                {hasTextQuery && searchResultTab === 'messages' ? (
                    <MessageSearchResults
                        api={api}
                        query={normalizedQuery}
                        state={messageSearchState}
                        onSelect={props.onSelect}
                        sessionTitles={messageSearchSessionTitles}
                    />
                ) : null}

                {showSessionSections ? renderSessionSection({
                    sectionKey: 'working-section',
                    titleKey: 'sessions.runningSection',
                    collapsed: false,
                    sessions: workingSessions,
                    activityTimeBasis: 'user',
                    collapsible: false,
                }) : null}
                {showSessionSections ? renderSessionSection({
                    sectionKey: 'active-section',
                    titleKey: 'sessions.activeSection',
                    collapsed: false,
                    sessions: activeSessions,
                    activityTimeBasis: 'agent',
                    collapsible: false,
                }) : null}
                {showSessionSections ? renderSessionSection({
                    sectionKey: 'idle-section',
                    titleKey: 'session.item.idle',
                    collapsed: false,
                    sessions: idleSessions,
                    activityTimeBasis: 'agent',
                    collapsible: false,
                    statusColorClass: 'bg-[var(--app-hint)]',
                }) : null}
                {showSessionSections ? renderRecentSessions() : null}
                {showSessionSections ? groups.map(renderDirectoryGroup) : null}
            </SessionListScrollAnchor>
            </div>
            </div>
            <ProjectActionMenu
                state={projectMenu}
                onClose={() => setProjectMenu(null)}
                onDelete={setProjectDeleteTarget}
                currentContext={projectMenu && projectMenu.sessions[0] ? resolveSessionContext(projectMenu.sessions[0], contextOptions) : undefined}
                onSetContext={(ctx) => {
                    if (projectMenu) {
                        setProjectContextOverride(projectMenu.directory, ctx)
                    }
                }}
            />
            <ConfirmDialog
                isOpen={projectDeleteTarget !== null}
                onClose={() => {
                    if (!projectDeletePending) setProjectDeleteTarget(null)
                }}
                title={t('sessions.project.deleteTitle')}
                description={t('sessions.project.deleteDescription', {
                    count: projectDeleteTarget?.sessions.length ?? 0,
                    name: projectDeleteTarget?.title ?? '',
                })}
                confirmLabel={t('sessions.project.deleteConfirm')}
                confirmingLabel={t('sessions.project.deleting')}
                onConfirm={deleteProjectSessions}
                isPending={projectDeletePending}
                centerTitle
                destructive
            />
            <ConfirmDialog
                isOpen={markAllReadOpen}
                onClose={() => setMarkAllReadOpen(false)}
                title={t('sessions.markAllRead.title')}
                description={t('sessions.markAllRead.description', { count: unreadSessionCount })}
                confirmLabel={t('sessions.markAllRead.confirm')}
                confirmingLabel={t('sessions.markAllRead.confirming')}
                onConfirm={async () => {
                    markAllSessionsSeen(readableSessions)
                }}
                isPending={false}
                centerTitle
                destructive
            />
        </div>
    )
}
