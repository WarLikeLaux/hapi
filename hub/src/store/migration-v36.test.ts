import { describe, expect, it } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Store } from './index'

describe('schema migration v35 to v36', () => {
    it('adds the per-message buttons_json column', () => {
        const dir = mkdtempSync(join(tmpdir(), 'hapi-message-buttons-migration-'))
        const path = join(dir, 'hapi.db')
        let store: Store | null = null
        try {
            store = new Store(path)
            store.close()
            const versionDb = new Database(path)
            versionDb.exec(`
                ALTER TABLE external_messages DROP COLUMN buttons_json;
                PRAGMA user_version = 35;
            `)
            versionDb.close()

            store = new Store(path)
            const internalDb = (store as unknown as { db: Database }).db
            const version = internalDb.prepare('PRAGMA user_version').get() as { user_version: number }
            const messages = internalDb.prepare('PRAGMA table_info(external_messages)').all() as Array<{ name: string }>

            expect(version.user_version).toBe(36)
            expect(messages.some((column) => column.name === 'buttons_json')).toBe(true)
        } finally {
            store?.close()
            rmSync(dir, { recursive: true, force: true })
        }
    })
})
