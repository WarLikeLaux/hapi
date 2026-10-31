import type { Database } from 'bun:sqlite'

export type ProjectPreference = {
    machineId: string
    path: string
    alias: string | null
    section: 'auto' | 'work' | 'recent'
    priority: boolean
    isDefault: boolean
    hidden?: boolean
}

export function createProjectPreferenceTable(db: Database): void {
    db.exec(`CREATE TABLE IF NOT EXISTS project_preferences (
        namespace TEXT NOT NULL PRIMARY KEY,
        projects TEXT NOT NULL
    )`)
}

export class ProjectPreferenceStore {
    constructor(private readonly db: Database) {}
    list(namespace: string): ProjectPreference[] {
        const row = this.db.query('SELECT projects FROM project_preferences WHERE namespace = ?').get(namespace) as { projects: string } | null
        return row ? JSON.parse(row.projects) as ProjectPreference[] : []
    }
    save(namespace: string, projects: ProjectPreference[]): void {
        this.db.query(`INSERT INTO project_preferences (namespace, projects) VALUES (?, ?)
            ON CONFLICT(namespace) DO UPDATE SET projects = excluded.projects`).run(namespace, JSON.stringify(projects))
    }
}
