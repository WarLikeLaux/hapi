import type { Database } from 'bun:sqlite'
import type { SessionGroup, UpdateSessionGroup } from '@hapi/protocol'

export function createSessionGroupTables(db: Database): void {
    db.exec(`
        CREATE TABLE IF NOT EXISTS session_groups (
            id TEXT PRIMARY KEY, namespace TEXT NOT NULL, name TEXT NOT NULL,
            version INTEGER NOT NULL DEFAULT 1, updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_session_groups_namespace ON session_groups(namespace);
        CREATE TABLE IF NOT EXISTS session_group_members (
            session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
            group_id TEXT NOT NULL REFERENCES session_groups(id) ON DELETE CASCADE,
            position INTEGER NOT NULL, pinned INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_session_group_members_group ON session_group_members(group_id, position);
    `)
}

/** Runs inside the caller's metadata transaction so archive and detachment commit together. */
export function detachSessionFromGroup(db: Database, sessionId: string, namespace: string): void {
    db.query(`UPDATE session_groups SET version = version + 1, updated_at = ?
        WHERE namespace = ? AND id IN (SELECT group_id FROM session_group_members WHERE session_id = ?)`).run(Date.now(), namespace, sessionId)
    db.query(`DELETE FROM session_group_members WHERE session_id = ?
        AND group_id IN (SELECT id FROM session_groups WHERE namespace = ?)`).run(sessionId, namespace)
}

export class SessionGroupError extends Error {
    constructor(message: string, readonly status: 404 | 409 | 400) { super(message) }
}

/** Membership is separate from session metadata and never changes history or lifecycle. */
export class SessionGroupStore {
    constructor(private readonly db: Database) {
        // Reconcile persisted membership from earlier previews or an offline archive.
        this.db.transaction(() => {
            const archived = this.db.query(`SELECT s.id, s.namespace FROM sessions s
                JOIN session_group_members m ON m.session_id = s.id
                WHERE json_extract(s.metadata, '$.lifecycleState') = 'archived'`).all() as { id: string; namespace: string }[]
            for (const session of archived) detachSessionFromGroup(this.db, session.id, session.namespace)
        })()
    }

    list(namespace: string): SessionGroup[] {
        const rows = this.db.query('SELECT id FROM session_groups WHERE namespace = ? ORDER BY updated_at DESC, id').all(namespace) as { id: string }[]
        return rows.map(row => this.get(namespace, row.id)!)
    }

    get(namespace: string, id: string): SessionGroup | null {
        const row = this.db.query('SELECT id, name, version, updated_at AS updatedAt FROM session_groups WHERE id = ? AND namespace = ?').get(id, namespace) as Omit<SessionGroup, 'members'> | null
        if (!row) return null
        const members = this.db.query(`SELECT m.session_id AS sessionId, m.pinned FROM session_group_members m
            JOIN sessions s ON s.id = m.session_id WHERE m.group_id = ? AND s.namespace = ?
            ORDER BY m.pinned DESC, m.position, m.session_id`).all(id, namespace) as { sessionId: string; pinned: number }[]
        return { ...row, members: members.map(member => ({ ...member, pinned: Boolean(member.pinned) })) }
    }

    forSession(namespace: string, sessionId: string): SessionGroup | null {
        const row = this.db.query(`SELECT m.group_id AS id FROM session_group_members m
            JOIN sessions s ON s.id = m.session_id WHERE s.id = ? AND s.namespace = ?`).get(sessionId, namespace) as { id: string } | null
        return row ? this.get(namespace, row.id) : null
    }

    create(namespace: string, name: string): SessionGroup {
        const id = crypto.randomUUID()
        this.db.query('INSERT INTO session_groups (id, namespace, name, updated_at) VALUES (?, ?, ?, ?)').run(id, namespace, name, Date.now())
        return this.get(namespace, id)!
    }

    update(namespace: string, id: string, input: UpdateSessionGroup): SessionGroup {
        return this.db.transaction(() => {
            const group = this.get(namespace, id)
            if (!group) throw new SessionGroupError('Group not found', 404)
            if (group.version !== input.version) throw new SessionGroupError('Group changed on another device. Reload and try again.', 409)
            const touched = new Set<string>([id])
            for (const member of input.members) {
                if (!this.db.query('SELECT 1 FROM sessions WHERE id = ? AND namespace = ?').get(member.sessionId, namespace)) {
                    throw new SessionGroupError('Chat not found', 404)
                }
                if (this.db.query("SELECT 1 FROM sessions WHERE id = ? AND json_extract(metadata, '$.lifecycleState') = 'archived'").get(member.sessionId)) {
                    throw new SessionGroupError('Closed chats cannot be added to a group. Reopen the chat first.', 400)
                }
                const previous = this.db.query('SELECT group_id AS id FROM session_group_members WHERE session_id = ?').get(member.sessionId) as { id: string } | null
                if (previous) touched.add(previous.id)
            }
            this.db.query('DELETE FROM session_group_members WHERE group_id = ?').run(id)
            const insert = this.db.query(`INSERT INTO session_group_members (session_id, group_id, position, pinned) VALUES (?, ?, ?, ?)
                ON CONFLICT(session_id) DO UPDATE SET group_id = excluded.group_id, position = excluded.position, pinned = excluded.pinned`)
            input.members.forEach((member, position) => insert.run(member.sessionId, id, position, Number(member.pinned)))
            for (const groupId of touched) {
                this.db.query('UPDATE session_groups SET version = version + 1, updated_at = ? WHERE id = ? AND namespace = ?').run(Date.now(), groupId, namespace)
            }
            this.db.query('UPDATE session_groups SET name = ? WHERE id = ? AND namespace = ?').run(input.name, id, namespace)
            return this.get(namespace, id)!
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
