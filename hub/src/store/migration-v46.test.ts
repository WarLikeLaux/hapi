import { expect, it, spyOn } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Store } from './index'

it('upgrades the fork v45 database without replacing titles, activity or model preferences', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hapi-fork-v45-'))
    const path = join(dir, 'hub.db')
    let store: Store | undefined
    try {
        store = new Store(path)
        const clock = spyOn(Date, 'now').mockReturnValue(100)
        const session = store.sessions.getOrCreateSession('protected', {
            path: '/workspace', host: 'test', name: 'Manual title', nameLock: 'user', muted: true
        }, null, 'default')
        clock.mockRestore()
        store.sessions.updateSessionMetadata(session.id, { ...session.metadata as object, nameLock: 'user' }, session.metadataVersion, 'default', { titleOperation: 'user' })
        store.messages.addMessage(session.id, { role: 'user', content: { type: 'text', text: 'Earlier input' } }, 'input', null, 500)
        store.modelPreferences.save('default', {
            agent: 'codex', modelId: 'custom-model', pinned: true, alias: 'Work', reasoningEffort: 'high', speed: 'standard'
        })
        store.sessions.recordSessionUserActivity(session.id, 777, 'default')
        store.close()
        store = undefined

        const legacy = new Database(path)
        legacy.exec(`
            DROP TABLE session_turns;
            DROP INDEX idx_messages_future_scheduled_queued;
            PRAGMA user_version = 45;
        `)
        legacy.close()

        store = new Store(path)
        expect(store.sessions.getSession(session.id)).toMatchObject({
            metadata: { name: 'Manual title', nameLock: 'user', muted: true }, lastUserMessageAt: 777
        })
        expect(store.modelPreferences.list('default')).toMatchObject([{
            modelId: 'custom-model', pinned: true, alias: 'Work', reasoningEffort: 'high', speed: 'standard'
        }])
        expect(store.messages.getAllMessages(session.id)).toHaveLength(1)
        expect(store.turns.open(session.id, 'default', 1_000, 'hub_prompt')).toBe(true)
        expect(store.turns.open(session.id, 'default', 2_000, 'agent')).toBe(false)
        expect(store.turns.list('default', 0, 3_000)).toHaveLength(1)
        const db = (store as unknown as { db: Database }).db
        expect(db.query('PRAGMA user_version').get()).toEqual({ user_version: 47 })
        expect(db.query("SELECT name FROM sqlite_master WHERE name = 'idx_messages_future_scheduled_queued'").get()).not.toBeNull()
    } finally {
        store?.close()
        rmSync(dir, { recursive: true, force: true })
    }
})
