import { describe, expect, it } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Store } from './index'

describe('schema migration v27 to v28', () => {
    it('adds namespace-isolated messenger conversation and message tables', () => {
        const dir = mkdtempSync(join(tmpdir(), 'hapi-messenger-migration-'))
        const path = join(dir, 'hapi.db')
        let store: Store | null = null
        try {
            // Construct the full prior schema without duplicating its fixture,
            // then remove only the V28 tables and pin the version back to V27.
            store = new Store(path)
            store.close()
            const versionDb = new Database(path)
            versionDb.exec(`
                DROP TABLE external_messages;
                DROP TABLE external_conversations;
                PRAGMA user_version = 27;
            `)
            versionDb.close()

            store = new Store(path)
            const internalDb = (store as unknown as { db: Database }).db
            const version = internalDb.prepare('PRAGMA user_version').get() as { user_version: number }
            const tables = internalDb.prepare(`
                SELECT name FROM sqlite_master
                WHERE type = 'table' AND name IN ('external_conversations', 'external_messages')
                ORDER BY name
            `).all() as Array<{ name: string }>
            expect(version.user_version).toBe(31)
            expect(tables.map((row) => row.name)).toEqual(['external_conversations', 'external_messages'])

            store.messengers.upsertConversation('one', {
                id: 'telegram:user:1',
                provider: 'telegram',
                remoteId: 'user:1',
                title: 'One',
                kind: 'direct',
                selected: true,
                lastMessageAt: null,
                lastMessagePreview: null,
                unreadCount: 0
            })
            expect(store.messengers.listConversations('one')).toHaveLength(1)
            expect(store.messengers.listConversations('two')).toHaveLength(0)
        } finally {
            store?.close()
            rmSync(dir, { recursive: true, force: true })
        }
    })
})
