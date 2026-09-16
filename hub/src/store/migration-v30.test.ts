import { describe, expect, it } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Store } from './index'

describe('schema migration v29 to v30', () => {
    it('adds the deduplicated external participant cache', () => {
        const dir = mkdtempSync(join(tmpdir(), 'hapi-messenger-participant-migration-'))
        const path = join(dir, 'hapi.db')
        let store: Store | null = null
        try {
            store = new Store(path)
            store.close()
            const versionDb = new Database(path)
            versionDb.exec('DROP TABLE external_participants; PRAGMA user_version = 29;')
            versionDb.close()

            store = new Store(path)
            const internalDb = (store as unknown as { db: Database }).db
            const version = internalDb.prepare('PRAGMA user_version').get() as { user_version: number }
            const table = internalDb.prepare(`
                SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'external_participants'
            `).get() as { name: string } | undefined

            expect(version.user_version).toBe(31)
            expect(table?.name).toBe('external_participants')
        } finally {
            store?.close()
            rmSync(dir, { recursive: true, force: true })
        }
    })
})
