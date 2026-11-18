export const HUB_OWNED_SESSION_METADATA_KEYS = [
    'supersededBySessionId', 'opencodeClearOperation', 'promptTitle',
    'codexArchivedFork', 'codexResumePending', 'opencodeRewind', 'opencodeForkPending',
    'jobsAcceptedFromSessionIds', 'jobsTransferredToSessionId', 'jobKeyRedirects'
] as const

/** CLI metadata can carry these fields back, but only the Hub can change them. */
export function preserveHubOwnedSessionMetadata(
    incoming: unknown,
    current: unknown
): Record<string, unknown> {
    // Reconnecting clients can send a null/sparse snapshot. Treat a non-object
    // as an empty write so it cannot bypass durable metadata preservation.
    const next = incoming && typeof incoming === 'object' && !Array.isArray(incoming)
        ? { ...incoming as Record<string, unknown> }
        : {}
    const existing = current && typeof current === 'object' && !Array.isArray(current)
        ? current as Record<string, unknown>
        : {}
    for (const key of HUB_OWNED_SESSION_METADATA_KEYS) {
        if (Object.prototype.hasOwnProperty.call(existing, key)) next[key] = existing[key]
        else delete next[key]
    }
    const rewind = existing.opencodeRewind
    if (rewind && typeof rewind === 'object' && 'phase' in rewind
        && (rewind.phase === 'reserved' || rewind.phase === 'prepared' || rewind.phase === 'unknown')) {
        for (const key of ['opencodeHistoryCheckpoint', 'conversationHistoryIndexes', 'conversationHistoryPoints']) {
            if (Object.prototype.hasOwnProperty.call(existing, key)) next[key] = existing[key]
            else delete next[key]
        }
    }
    return next
}
