import { describe, expect, it } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Store } from './index'

describe('schema migration v35 to v36', () => {
    it('adds reply quote snapshot columns', () => {
        const dir = mkdtempSync(join(tmpdir(), 'hapi-message-reply-migration-'))
        const path = join(dir, 'hapi.db')
        let store: Store | null = null
        try {
            store = new Store(path)
            store.close()
            const versionDb = new Database(path)
            versionDb.exec(`
                ALTER TABLE external_messages DROP COLUMN reply_to_provider_message_id;
                ALTER TABLE external_messages DROP COLUMN reply_to_sender_name;
                ALTER TABLE external_messages DROP COLUMN reply_to_text;
                PRAGMA user_version = 35;
            `)
            versionDb.close()

            store = new Store(path)
            const internalDb = (store as unknown as { db: Database }).db
            const version = internalDb.prepare('PRAGMA user_version').get() as { user_version: number }
            const messages = internalDb.prepare('PRAGMA table_info(external_messages)').all() as Array<{ name: string }>

            expect(version.user_version).toBe(36)
            expect(messages.some((column) => column.name === 'reply_to_provider_message_id')).toBe(true)
            expect(messages.some((column) => column.name === 'reply_to_sender_name')).toBe(true)
            expect(messages.some((column) => column.name === 'reply_to_text')).toBe(true)
        } finally {
            store?.close()
            rmSync(dir, { recursive: true, force: true })
        }
    })
})
