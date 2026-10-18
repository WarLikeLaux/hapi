import type { Database } from 'bun:sqlite'
import { prepareCached } from './statementCache'
import { getSession } from './sessions'
import type { StoredMessage } from './types'
import { parseUsageEvent } from './usageEvent'
import { getUsageScanStates, recordUsageScan } from './usage'

/** Maintain the usage index in the message's insert transaction. */
export function recordMessageUsage(db: Database, message: StoredMessage, epoch: number): void {
    const state = getUsageScanStates(db, [message.sessionId]).get(message.sessionId)
    const lastSeq = state?.lastSeq ?? 0
    const indexedEpoch = state?.messageEpoch ?? epoch
    const session = getSession(db, message.sessionId)
    if (!session) return
    const event = parseUsageEvent(session, message)
    if (event && event.model === null) {
        const indexed = prepareCached(db, 'SELECT model FROM usage_events WHERE session_id = ? AND source_key = ?')
            .get(session.id, event.sourceKey) as { model: string | null } | undefined
        event.model = indexed?.model ?? (session.model?.trim() || null)
    }
    // A gap belongs to old history awaiting backfill. Never advance past it,
    // or claim a rewritten epoch has been indexed merely by appending a row.
    recordUsageScan(db, session.id, indexedEpoch,
        indexedEpoch === epoch && message.seq === lastSeq + 1 ? message.seq : lastSeq,
        event ? [event] : [], false)
}
