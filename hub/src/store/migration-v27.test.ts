import { afterEach, describe, expect, it } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Store } from './index'

const tempDirs: string[] = []

afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
        rmSync(dir, { recursive: true, force: true })
    }
})

describe('schema migration v26 to v27', () => {
    it('adds and backfills last_user_message_at from user messages only', () => {
        const originalDateNow = Date.now
        let now = 1_000
        Date.now = () => now
        try {
            const dir = mkdtempSync(join(tmpdir(), 'hapi-migration-v27-'))
            tempDirs.push(dir)
            const dbPath = join(dir, 'hapi.db')

            const initial = new Store(dbPath)
            const session = initial.sessions.getOrCreateSession('session', {}, null, 'default')
            now = 2_000
            initial.messages.addMessage(session.id, { role: 'user', content: { type: 'text', text: 'hello' } })
            now = 3_000
            initial.messages.addMessage(session.id, { role: 'agent', content: { type: 'text', text: 'later reply' } })
            initial.close()

            const legacy = new Database(dbPath)
            legacy.exec(`
                UPDATE sessions SET last_user_message_at = NULL;
                PRAGMA user_version = 26;
            `)
            legacy.close()

            const migrated = new Store(dbPath)
            const stored = migrated.sessions.getSession(session.id)
            const internalDb = (migrated as unknown as { db: Database }).db
            const version = internalDb.prepare('PRAGMA user_version').get() as { user_version: number }

            expect(version.user_version).toBe(31)
            expect(stored?.lastUserMessageAt).toBe(2_000)
            migrated.close()
        } finally {
            Date.now = originalDateNow
        }
    })
})
