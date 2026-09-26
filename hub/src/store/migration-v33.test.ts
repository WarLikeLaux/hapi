import { describe, expect, it } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Store } from './index'

describe('schema migration v32 to v33', () => {
    it('adds cached message reactions', () => {
        const dir = mkdtempSync(join(tmpdir(), 'hapi-message-reactions-migration-'))
        const path = join(dir, 'hapi.db')
        let store: Store | null = null
        try {
            store = new Store(path)
            store.close()
            const versionDb = new Database(path)
            versionDb.exec(`
                ALTER TABLE external_messages DROP COLUMN reactions_json;
                PRAGMA user_version = 32;
            `)
            versionDb.close()

            store = new Store(path)
            const internalDb = (store as unknown as { db: Database }).db
            const version = internalDb.prepare('PRAGMA user_version').get() as { user_version: number }
            const messages = internalDb.prepare('PRAGMA table_info(external_messages)').all() as Array<{ name: string }>

            expect(version.user_version).toBe(34)
            expect(messages.some((column) => column.name === 'reactions_json')).toBe(true)
        } finally {
            store?.close()
            rmSync(dir, { recursive: true, force: true })
        }
    })
})
