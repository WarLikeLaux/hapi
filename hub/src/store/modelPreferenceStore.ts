import type { Database } from 'bun:sqlite'

export type ModelPreference = {
    agent: string
    modelId: string
    pinned: boolean
    alias: string | null
    hidden?: boolean
    reasoningEffort?: string | null
    speed?: 'fast' | 'standard' | null
    showInAll?: boolean
}

export function createModelPreferenceTable(db: Database): void {
    db.exec(`CREATE TABLE IF NOT EXISTS model_preferences (
        namespace TEXT NOT NULL,
        agent TEXT NOT NULL,
        model_id TEXT NOT NULL,
        pinned INTEGER NOT NULL DEFAULT 0,
        alias TEXT,
        hidden INTEGER NOT NULL DEFAULT 0,
        pin_order INTEGER,
        reasoning_effort TEXT,
        speed TEXT,
        show_in_all INTEGER NOT NULL DEFAULT 1,
        PRIMARY KEY (namespace, agent, model_id)
    )`)
}

export class ModelPreferenceStore {
    constructor(private readonly db: Database) {}

    list(namespace: string): ModelPreference[] {
        const rows = this.db.query(`SELECT agent, model_id AS modelId, pinned, alias, hidden, reasoning_effort AS reasoningEffort, speed, show_in_all AS showInAll
            FROM model_preferences WHERE namespace = ?
            ORDER BY pinned DESC, pin_order ASC, agent ASC, model_id ASC`).all(namespace) as Array<{
                agent: string; modelId: string; pinned: number; alias: string | null; hidden: number; reasoningEffort: string | null; speed: 'fast' | 'standard' | null; showInAll: number
            }>
        return rows.map(row => ({ ...row, pinned: row.pinned === 1, hidden: row.hidden === 1, showInAll: row.showInAll === 1 }))
    }

    save(namespace: string, preference: ModelPreference): ModelPreference {
        const existing = this.db.query(`SELECT pinned, pin_order AS pinOrder FROM model_preferences
            WHERE namespace = ? AND agent = ? AND model_id = ?`).get(namespace, preference.agent, preference.modelId) as {
                pinned: number; pinOrder: number | null
            } | null
        if (!preference.pinned && !preference.alias && !preference.hidden && !preference.reasoningEffort && !preference.speed && preference.showInAll !== false) {
            this.db.query('DELETE FROM model_preferences WHERE namespace = ? AND agent = ? AND model_id = ?')
                .run(namespace, preference.agent, preference.modelId)
            return preference
        }
        const nextOrder = preference.pinned && existing?.pinned === 1 ? existing.pinOrder
            : preference.pinned ? (this.db.query(`SELECT COALESCE(MAX(pin_order), 0) + 1 AS value
                FROM model_preferences WHERE namespace = ?`).get(namespace) as { value: number }).value
                : null
        this.db.query(`INSERT INTO model_preferences (namespace, agent, model_id, pinned, alias, hidden, pin_order, reasoning_effort, speed, show_in_all)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(namespace, agent, model_id) DO UPDATE SET
                pinned = excluded.pinned, alias = excluded.alias, hidden = excluded.hidden, pin_order = excluded.pin_order, reasoning_effort = excluded.reasoning_effort, speed = excluded.speed, show_in_all = excluded.show_in_all`)
            .run(namespace, preference.agent, preference.modelId, preference.pinned ? 1 : 0, preference.alias, preference.hidden ? 1 : 0, nextOrder, preference.reasoningEffort ?? null, preference.speed ?? null, preference.showInAll === false ? 0 : 1)
        return preference
    }

    reorder(namespace: string, agent: string, modelIds: string[]): void {
        const apply = this.db.transaction(() => {
            for (const [index, modelId] of modelIds.entries()) {
                this.db.query(`INSERT INTO model_preferences (namespace, agent, model_id, pinned, hidden, pin_order)
                    VALUES (?, ?, ?, 1, 0, ?)
                    ON CONFLICT(namespace, agent, model_id) DO UPDATE SET pinned = 1, hidden = 0, pin_order = excluded.pin_order`)
                    .run(namespace, agent, modelId, index + 1)
            }
        })
        apply()
    }
}
