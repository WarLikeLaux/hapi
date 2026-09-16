import { describe, expect, it } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Store } from './index'

describe('schema migration v28 to v29', () => {
    it('adds cached messenger avatars and typed media metadata', () => {
        const dir = mkdtempSync(join(tmpdir(), 'hapi-messenger-media-migration-'))
        const path = join(dir, 'hapi.db')
        let store: Store | null = null
        try {
            store = new Store(path)
            store.close()
            const versionDb = new Database(path)
            versionDb.exec(`
                ALTER TABLE external_messages DROP COLUMN media_json;
                ALTER TABLE external_conversations DROP COLUMN avatar_data_url;
                PRAGMA user_version = 28;
            `)
            versionDb.close()

            store = new Store(path)
            const internalDb = (store as unknown as { db: Database }).db
            const version = internalDb.prepare('PRAGMA user_version').get() as { user_version: number }
            const conversationColumns = internalDb.prepare('PRAGMA table_info(external_conversations)').all() as Array<{ name: string }>
            const messageColumns = internalDb.prepare('PRAGMA table_info(external_messages)').all() as Array<{ name: string }>

            expect(version.user_version).toBe(29)
            expect(conversationColumns.some((column) => column.name === 'avatar_data_url')).toBe(true)
            expect(messageColumns.some((column) => column.name === 'media_json')).toBe(true)
        } finally {
            store?.close()
            rmSync(dir, { recursive: true, force: true })
        }
    })
})
