import type { Database } from 'bun:sqlite'

export type BrowserTitles = { work: string; regular: string }

export function createBrowserTitleTable(db: Database): void {
    db.exec(`CREATE TABLE IF NOT EXISTS browser_titles (
        namespace TEXT NOT NULL PRIMARY KEY,
        work TEXT NOT NULL,
        regular TEXT NOT NULL
    )`)
}

export class BrowserTitleStore {
    constructor(private readonly db: Database) {}

    get(namespace: string): BrowserTitles {
        return this.db.query('SELECT work, regular FROM browser_titles WHERE namespace = ?').get(namespace) as BrowserTitles | null
            ?? { work: 'HAPI', regular: 'HAPI' }
    }

    save(namespace: string, titles: BrowserTitles): BrowserTitles {
        this.db.query(`INSERT INTO browser_titles (namespace, work, regular) VALUES (?, ?, ?)
            ON CONFLICT(namespace) DO UPDATE SET work = excluded.work, regular = excluded.regular`)
            .run(namespace, titles.work, titles.regular)
        return titles
    }
}
