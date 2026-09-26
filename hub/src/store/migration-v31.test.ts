import { describe, expect, it } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Store } from './index'

describe('schema migration v30 to v31', () => {
    it('adds Telegram delivery status columns', () => {
        const dir = mkdtempSync(join(tmpdir(), 'hapi-messenger-receipt-migration-'))
        const path = join(dir, 'hapi.db')
        let store: Store | null = null
        try {
            store = new Store(path)
            store.close()
            const versionDb = new Database(path)
            versionDb.exec(`
                ALTER TABLE external_messages DROP COLUMN delivery_status;
                ALTER TABLE external_conversations DROP COLUMN last_message_delivery_status;
                ALTER TABLE external_conversations DROP COLUMN last_message_direction;
                PRAGMA user_version = 30;
            `)
            versionDb.close()

            store = new Store(path)
            const internalDb = (store as unknown as { db: Database }).db
            const version = internalDb.prepare('PRAGMA user_version').get() as { user_version: number }
            const conversations = internalDb.prepare('PRAGMA table_info(external_conversations)').all() as Array<{ name: string }>
            const messages = internalDb.prepare('PRAGMA table_info(external_messages)').all() as Array<{ name: string }>

            expect(version.user_version).toBe(34)
            expect(conversations.some((column) => column.name === 'last_message_direction')).toBe(true)
            expect(conversations.some((column) => column.name === 'last_message_delivery_status')).toBe(true)
            expect(messages.some((column) => column.name === 'delivery_status')).toBe(true)
        } finally {
            store?.close()
            rmSync(dir, { recursive: true, force: true })
        }
    })
})
