import type { Database } from 'bun:sqlite'
import type { SessionGroup, UpdateSessionGroup } from '@hapi/protocol'

export function createSessionGroupTables(db: Database): void {
    db.exec(`
        CREATE TABLE IF NOT EXISTS session_groups (
            id TEXT PRIMARY KEY, namespace TEXT NOT NULL, name TEXT NOT NULL,
            version INTEGER NOT NULL DEFAULT 1, updated_at INTEGER NOT NULL,
            parked INTEGER NOT NULL DEFAULT 0, closed INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_session_groups_namespace ON session_groups(namespace);
        CREATE TABLE IF NOT EXISTS session_group_members (
            session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
            group_id TEXT NOT NULL REFERENCES session_groups(id) ON DELETE CASCADE,
            position INTEGER NOT NULL, pinned INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_session_group_members_group ON session_group_members(group_id, position);
        CREATE TABLE IF NOT EXISTS session_group_creation_requests (
            namespace TEXT NOT NULL, request_id TEXT NOT NULL, name TEXT NOT NULL,
            group_id TEXT NOT NULL REFERENCES session_groups(id) ON DELETE CASCADE,
            PRIMARY KEY (namespace, request_id)
        );
    `)
    const columns = db.query('PRAGMA table_info(session_groups)').all() as { name: string }[]
    if (!columns.some(column => column.name === 'closed')) {
        db.exec('ALTER TABLE session_groups ADD COLUMN closed INTEGER NOT NULL DEFAULT 0')
    }
    if (!columns.some(column => column.name === 'parked')) {
        db.exec('ALTER TABLE session_groups ADD COLUMN parked INTEGER NOT NULL DEFAULT 0')
    }
}

/** Runs inside the caller's metadata transaction so archive and detachment commit together. */
export function detachSessionFromGroup(db: Database, sessionId: string, namespace: string): void {
    db.query(`UPDATE session_groups SET version = version + 1, updated_at = ?
        WHERE namespace = ? AND closed = 0 AND id IN (SELECT group_id FROM session_group_members WHERE session_id = ?)`).run(Date.now(), namespace, sessionId)
    db.query(`DELETE FROM session_group_members WHERE session_id = ?
        AND group_id IN (SELECT id FROM session_groups WHERE namespace = ? AND closed = 0)`).run(sessionId, namespace)
}

export class SessionGroupError extends Error {
    constructor(message: string, readonly status: 404 | 409 | 400) { super(message) }
}

/** Membership is separate from session metadata and never changes history or lifecycle. */
export class SessionGroupStore {
    private readonly lifecycleOperations = new Set<string>()
    constructor(private readonly db: Database) {
        // Reconcile persisted membership from earlier previews or an offline archive.
        this.db.transaction(() => {
            const archived = this.db.query(`SELECT s.id, s.namespace FROM sessions s
                JOIN session_group_members m ON m.session_id = s.id
                JOIN session_groups g ON g.id = m.group_id
                WHERE g.closed = 0 AND json_extract(s.metadata, '$.lifecycleState') = 'archived'`).all() as { id: string; namespace: string }[]
            for (const session of archived) detachSessionFromGroup(this.db, session.id, session.namespace)
        })()
    }

    list(namespace: string): SessionGroup[] {
        const rows = this.db.query('SELECT id FROM session_groups WHERE namespace = ? ORDER BY updated_at DESC, id').all(namespace) as { id: string }[]
        return rows.map(row => this.get(namespace, row.id)!)
    }

    get(namespace: string, id: string): SessionGroup | null {
        const row = this.db.query('SELECT id, name, version, updated_at AS updatedAt, parked, closed FROM session_groups WHERE id = ? AND namespace = ?').get(id, namespace) as (Omit<SessionGroup, 'members' | 'parked' | 'closed'> & { parked: number; closed: number }) | null
        if (!row) return null
        const members = this.db.query(`SELECT m.session_id AS sessionId, m.pinned FROM session_group_members m
            JOIN sessions s ON s.id = m.session_id WHERE m.group_id = ? AND s.namespace = ?
            ORDER BY m.pinned DESC, m.position, m.session_id`).all(id, namespace) as { sessionId: string; pinned: number }[]
        return { ...row, parked: Boolean(row.parked), closed: Boolean(row.closed), members: members.map(member => ({ ...member, pinned: Boolean(member.pinned) })) }
    }

    forSession(namespace: string, sessionId: string): SessionGroup | null {
        const row = this.db.query(`SELECT m.group_id AS id FROM session_group_members m
            JOIN sessions s ON s.id = m.session_id WHERE s.id = ? AND s.namespace = ?`).get(sessionId, namespace) as { id: string } | null
        return row ? this.get(namespace, row.id) : null
    }

    /** A durable receipt makes a retry safe even after the response or hub process is lost. */
    create(namespace: string, name: string, requestId?: string): SessionGroup {
        return this.db.transaction(() => {
            if (requestId) {
                const receipt = this.db.query(`SELECT name, group_id AS groupId FROM session_group_creation_requests
                    WHERE namespace = ? AND request_id = ?`).get(namespace, requestId) as { name: string; groupId: string } | null
                if (receipt) {
                    if (receipt.name !== name) throw new SessionGroupError('Request ID already used with another group name. Reuse the original name or choose a new request ID.', 409)
                    return this.get(namespace, receipt.groupId)!
                }
            }
            const id = crypto.randomUUID()
            this.db.query('INSERT INTO session_groups (id, namespace, name, updated_at) VALUES (?, ?, ?, ?)').run(id, namespace, name, Date.now())
            if (requestId) this.db.query(`INSERT INTO session_group_creation_requests (namespace, request_id, name, group_id)
                VALUES (?, ?, ?, ?)`).run(namespace, requestId, name, id)
            return this.get(namespace, id)!
        })()
    }

    update(namespace: string, id: string, input: UpdateSessionGroup): SessionGroup {
        return this.db.transaction(() => {
            const group = this.get(namespace, id)
            if (!group) throw new SessionGroupError('Group not found', 404)
            if (this.lifecycleOperations.has(id)) throw new SessionGroupError('Group is opening or closing. Wait and retry.', 409)
            if (group.closed && input.parked) throw new SessionGroupError('Open this group before parking it.', 400)
            if (group.version !== input.version) throw new SessionGroupError('Group changed on another device. Reload and try again.', 409)
            const touched = new Set<string>([id])
            for (const member of input.members) {
                if (!this.db.query('SELECT 1 FROM sessions WHERE id = ? AND namespace = ?').get(member.sessionId, namespace)) {
                    throw new SessionGroupError('Chat not found', 404)
                }
                if (!(group.closed && group.members.some(existing => existing.sessionId === member.sessionId))
                    && this.db.query("SELECT 1 FROM sessions WHERE id = ? AND json_extract(metadata, '$.lifecycleState') = 'archived'").get(member.sessionId)) {
                    throw new SessionGroupError('Closed chats cannot be added to a group. Reopen the chat first.', 400)
                }
                const previous = this.db.query('SELECT group_id AS id FROM session_group_members WHERE session_id = ?').get(member.sessionId) as { id: string } | null
                if (previous && this.lifecycleOperations.has(previous.id)) throw new SessionGroupError('Group is opening or closing. Wait and retry.', 409)
                if (previous) touched.add(previous.id)
            }
            this.db.query('DELETE FROM session_group_members WHERE group_id = ?').run(id)
            const insert = this.db.query(`INSERT INTO session_group_members (session_id, group_id, position, pinned) VALUES (?, ?, ?, ?)
                ON CONFLICT(session_id) DO UPDATE SET group_id = excluded.group_id, position = excluded.position, pinned = excluded.pinned`)
            input.members.forEach((member, position) => insert.run(member.sessionId, id, position, Number(member.pinned)))
            for (const groupId of touched) {
                this.db.query('UPDATE session_groups SET version = version + 1, updated_at = ? WHERE id = ? AND namespace = ?').run(Date.now(), groupId, namespace)
            }
            this.db.query('UPDATE session_groups SET name = ?, parked = ? WHERE id = ? AND namespace = ?').run(input.name, Number(input.parked ?? group.parked), id, namespace)
            return this.get(namespace, id)!
        })()
    }

    beginLifecycle(namespace: string, id: string, version: number): SessionGroup {
        const group = this.get(namespace, id)
        if (!group) throw new SessionGroupError('Group not found', 404)
        if (this.lifecycleOperations.has(id) || group.version !== version) {
            throw new SessionGroupError('Group changed or is busy. Reload and try again.', 409)
        }
        // Persist the group before stopping its chats: archive callbacks must retain its tabs.
        this.db.query('UPDATE session_groups SET closed = 1, parked = 0, version = version + 1, updated_at = ? WHERE id = ? AND namespace = ?').run(Date.now(), id, namespace)
        this.lifecycleOperations.add(id)
        return this.get(namespace, id)!
    }

    finishLifecycle(namespace: string, id: string, closed: boolean, parked = false): SessionGroup {
        try {
            this.db.query('UPDATE session_groups SET closed = ?, parked = ?, version = version + 1, updated_at = ? WHERE id = ? AND namespace = ?').run(Number(closed), Number(parked), Date.now(), id, namespace)
            return this.get(namespace, id)!
        } finally { this.lifecycleOperations.delete(id) }
    }

    /** Keep the original tab position and pin when resume rotates a session ID. */
    transferSession(namespace: string, oldId: string, newId: string): boolean {
        return this.db.transaction(() => {
            const source = this.forSession(namespace, oldId)
            if (!source) return false
            const target = this.forSession(namespace, newId)
            if (target && target.id !== source.id) throw new SessionGroupError('Resumed chat already belongs to another group', 409)
            if (target) this.db.query('DELETE FROM session_group_members WHERE session_id = ?').run(newId)
            this.db.query('UPDATE session_group_members SET session_id = ? WHERE session_id = ?').run(newId, oldId)
            this.db.query('UPDATE session_groups SET version = version + 1, updated_at = ? WHERE id = ?').run(Date.now(), source.id)
            return true
        })()
    }

    add(namespace: string, id: string, sessionId: string): void {
        this.db.transaction(() => {
            const group = this.get(namespace, id)
            if (!group) throw new SessionGroupError('Group not found', 404)
            if (group.members.some(member => member.sessionId === sessionId)) return
            this.update(namespace, id, { ...group, members: [...group.members, { sessionId, pinned: false }] })
        })()
    }
}
