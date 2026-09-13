import type { SessionSummary } from '@/types/api'

export type SessionAttention =
    | { kind: 'permission' }
    | { kind: 'input' }
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

/** True when the session has activity newer than the operator's last-seen watermark. */
export function sessionIsUnread(
    summary: SessionSummary,
    options: { lastSeenAt: number }
): boolean {
    return getSessionUnreadActivityAt(summary) > options.lastSeenAt
}

export function classifySessionAttention(
    summary: SessionSummary,
    options: { selected: boolean; lastSeenAt: number; manualUnreadAt?: number | null }
): SessionAttention | null {
    if (options.selected) {
        return options.manualUnreadAt === getSessionUnreadActivityAt(summary)
            ? { kind: 'unread' }
            : null
    }

    if (summary.thinking) {
        return null
    }

    const pendingRequestKinds = Array.isArray(summary.pendingRequestKinds)
        ? summary.pendingRequestKinds
        : []

    if (pendingRequestKinds.includes('permission')) {
        return { kind: 'permission' }
    }

    if (pendingRequestKinds.includes('input')) {
        return { kind: 'input' }
    }

    if (summary.active && (summary.backgroundTaskCount ?? 0) > 0) {
        return { kind: 'background' }
    }

    if (sessionIsUnread(summary, { lastSeenAt: options.lastSeenAt })) {
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
    return options.detailed || attention?.kind === 'unread' ? attention : null
}

export function getSessionAttentionLabelKey(attention: SessionAttention): string {
    switch (attention.kind) {
        case 'permission':
            return 'session.item.permission'
        case 'input':
            return 'session.item.needsInput'
        case 'background':
            return 'session.item.background'
        case 'unread':
            return 'session.item.newActivity'
    }
}
