import type { Database } from 'bun:sqlite'
import type { LaunchSessionResult } from '@hapi/protocol'

export function createSessionLaunchTable(db: Database): void {
    // Receipts intentionally outlive deleted sessions: an old request must never respawn.
    db.exec(`CREATE TABLE IF NOT EXISTS session_launch_requests (
        namespace TEXT NOT NULL, request_id TEXT NOT NULL, input TEXT NOT NULL,
        result TEXT NOT NULL, PRIMARY KEY (namespace, request_id)
    )`)
}

export class SessionLaunchStore {
    constructor(private readonly db: Database) {}

    get(namespace: string, requestId: string): { input: string; result: LaunchSessionResult } | null {
        const row = this.db.query('SELECT input, result FROM session_launch_requests WHERE namespace = ? AND request_id = ?')
            .get(namespace, requestId) as { input: string; result: string } | null
        return row ? { input: row.input, result: JSON.parse(row.result) } : null
    }

    reserve(namespace: string, requestId: string, input: string): boolean {
        return this.db.query(`INSERT OR IGNORE INTO session_launch_requests (namespace, request_id, input, result)
            VALUES (?, ?, ?, ?)`)
            .run(namespace, requestId, input, JSON.stringify({ state: 'indeterminate' })).changes === 1
    }

    save(namespace: string, requestId: string, result: LaunchSessionResult): void {
        this.db.query('UPDATE session_launch_requests SET result = ? WHERE namespace = ? AND request_id = ?')
            .run(JSON.stringify(result), namespace, requestId)
    }
}
