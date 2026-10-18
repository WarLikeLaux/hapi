import type { Database } from 'bun:sqlite'
import { prepareCached } from './statementCache'

import {
    getUsageEvents,
    getUsageScanStates,
    recordUsageScan,
    transferUsageSession,
    type UsageEvent,
    type UsageScanState
} from './usage'

export class UsageStore {
    constructor(private readonly db: Database) {}

    getEventModel(sessionId: string, sourceKey: string): string | null {
        const event = prepareCached(this.db, 'SELECT model FROM usage_events WHERE session_id = ? AND source_key = ?')
            .get(sessionId, sourceKey) as { model: string | null } | undefined
        return event?.model ?? null
    }

    getPendingSessionIds(namespace: string): string[] {
        return (this.db.prepare(`
            SELECT s.id FROM sessions s
            LEFT JOIN usage_scan_state u ON u.session_id = s.id
            LEFT JOIN message_epochs e ON e.session_id = s.id
            WHERE s.namespace = ? AND (
                u.session_id IS NULL OR u.message_epoch != COALESCE(e.epoch, 0)
                OR u.last_seq < (SELECT MAX(m.seq) FROM messages m WHERE m.session_id = s.id)
            )
        `).all(namespace) as Array<{ id: string }>).map(row => row.id)
    }

    getModelActivity(namespace: string, from: number, to: number): Array<{
        sessionId: string; agent: string; model: string | null; lastUsedAt: number
    }> {
        return this.db.prepare(`
            SELECT u.session_id AS sessionId, u.agent, u.model, MAX(u.created_at) AS lastUsedAt
            FROM usage_events u
            JOIN sessions s ON s.id = u.session_id
            JOIN usage_scan_state scan ON scan.session_id = s.id
            LEFT JOIN message_epochs epoch ON epoch.session_id = s.id
            WHERE s.namespace = ? AND u.created_at BETWEEN ? AND ?
                AND scan.message_epoch = COALESCE(epoch.epoch, 0)
            GROUP BY u.session_id, u.agent, u.model
        `).all(namespace, from, to) as Array<{
            sessionId: string; agent: string; model: string | null; lastUsedAt: number
        }>
    }

    recordScan(
        sessionId: string,
        messageEpoch: number,
        lastSeq: number,
        events: UsageEvent[],
        replaceEvents: boolean
    ): void {
        recordUsageScan(this.db, sessionId, messageEpoch, lastSeq, events, replaceEvents)
    }

    getEvents(sessionIds: string[]): UsageEvent[] {
        return getUsageEvents(this.db, sessionIds)
    }

    getScanStates(sessionIds: string[]): Map<string, UsageScanState> {
        return getUsageScanStates(this.db, sessionIds)
    }

    transferSession(fromSessionId: string, toSessionId: string): void {
        transferUsageSession(this.db, fromSessionId, toSessionId)
    }
}
