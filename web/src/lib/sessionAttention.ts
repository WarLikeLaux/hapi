import type { SessionSummary } from '@/types/api'

export type SessionAttention =
    | { kind: 'permission' }
    | { kind: 'input' }
    | { kind: 'async-input' }
    | { kind: 'background' }
    | { kind: 'unread' }

/** Agent-authored conversation activity only; status/sync updates never create unread. */
export function getSessionUnreadActivityAt(summary: SessionSummary): number {
    // Explicit 0 from current hubs means "no agent message yet". Missing means
    // an older hub, where updatedAt is the only available compatibility signal.
    return Object.prototype.hasOwnProperty.call(summary, 'lastAgentMessageAt')
        ? summary.lastAgentMessageAt ?? 0
        : summary.updatedAt
}

function hasManualUnreadMarker(value: number | null | undefined): value is number {
    return typeof value === 'number' && Number.isFinite(value)
}

/** True when the session has activity newer than the operator's last-seen watermark. */
export function sessionIsUnread(
    summary: SessionSummary,
    options: { lastSeenAt: number; manualUnreadAt?: number | null }
): boolean {
    const manualUnread = options.manualUnreadAt === undefined
        ? summary.readState?.manualUnread === true
        : hasManualUnreadMarker(options.manualUnreadAt)
    return !summary.metadata?.muted && (manualUnread
        || (summary.contentRevision ?? 0) > Math.max(options.lastSeenAt, summary.readState?.readRevision ?? 0))
}

export function classifySessionAttention(
    summary: SessionSummary,
    options: { selected: boolean; lastSeenAt: number; manualUnreadAt?: number | null }
): SessionAttention | null {
    if (summary.metadata?.muted) return null
    const pendingRequestKinds = summary.active && Array.isArray(summary.pendingRequestKinds)
        ? summary.pendingRequestKinds
        : []
    if (pendingRequestKinds.includes('input')) {
        return (summary.pendingAsyncQuestionsCount ?? 0) > 0
            ? { kind: 'async-input' }
            : { kind: 'input' }
    }

    const manualUnread = options.manualUnreadAt === undefined
        ? summary.readState?.manualUnread === true
        : hasManualUnreadMarker(options.manualUnreadAt)
    if (options.selected) return manualUnread ? { kind: 'unread' } : null
    if (summary.active && summary.thinking && !manualUnread) {
        return null
    }

    if (pendingRequestKinds.includes('permission')) {
        return { kind: 'permission' }
    }

    if (summary.active && (summary.backgroundTaskCount ?? 0) > 0) {
        return { kind: 'background' }
    }

    if (sessionIsUnread(summary, {
        lastSeenAt: options.lastSeenAt,
        manualUnreadAt: options.manualUnreadAt
    })) {
        return { kind: 'unread' }
    }

    return null
}

export function classifyVisibleSessionAttention(
    summary: SessionSummary,
    options: {
        selected: boolean
        lastSeenAt: number
        manualUnreadAt?: number | null
        detailed: boolean
    }
): SessionAttention | null {
    const attention = classifySessionAttention(summary, options)
    return options.detailed || attention?.kind === 'unread' || attention?.kind === 'input' || attention?.kind === 'async-input'
        ? attention : null
}

export function getSessionAttentionLabelKey(attention: SessionAttention): string {
    switch (attention.kind) {
        case 'permission':
            return 'session.item.permission'
        case 'input':
            return 'session.item.needsInput'
        case 'async-input':
            return 'session.item.hasQuestion'
        case 'background':
            return 'session.item.background'
        case 'unread':
            return 'session.item.newActivity'
    }
}
