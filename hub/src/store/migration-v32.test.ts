import { describe, expect, it } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Store } from './index'

describe('schema migration v31 to v32', () => {
    it('adds local messenger alias columns', () => {
        const dir = mkdtempSync(join(tmpdir(), 'hapi-messenger-alias-migration-'))
        const path = join(dir, 'hapi.db')
        let store: Store | null = null
        try {
            store = new Store(path)
            store.close()
            const versionDb = new Database(path)
            versionDb.exec(`
                ALTER TABLE external_conversations DROP COLUMN custom_title;
                ALTER TABLE external_participants DROP COLUMN custom_name;
                PRAGMA user_version = 31;
            `)
            versionDb.close()

            store = new Store(path)
            const internalDb = (store as unknown as { db: Database }).db
            const version = internalDb.prepare('PRAGMA user_version').get() as { user_version: number }
            const conversations = internalDb.prepare('PRAGMA table_info(external_conversations)').all() as Array<{ name: string }>
            const participants = internalDb.prepare('PRAGMA table_info(external_participants)').all() as Array<{ name: string }>

            expect(version.user_version).toBe(33)
            expect(conversations.some((column) => column.name === 'custom_title')).toBe(true)
            expect(participants.some((column) => column.name === 'custom_name')).toBe(true)
        } finally {
            store?.close()
            rmSync(dir, { recursive: true, force: true })
        }
    })
})
