import { expect, it } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Store } from '.'

it('adds shared read state after fork v46 while preserving history, protected metadata and user clocks', () => {
    const directory = mkdtempSync(join(tmpdir(), 'hapi-read-state-v46-'))
    const filename = join(directory, 'hub.sqlite')
    let store: Store | undefined
    try {
        store = new Store(filename)
        const session = store.sessions.getOrCreateSession('legacy', {
            path: '/workspace', host: 'test', name: 'User title', readThrough: 400, muted: true
        }, null, 'tenant')
        store.sessions.updateSessionMetadata(session.id, session.metadata, session.metadataVersion, 'tenant', { titleOperation: 'user' })
        const userActivityAt = Date.now() + 1000
        store.sessions.recordSessionUserActivity(session.id, userActivityAt, 'tenant')
        const content = { role: 'agent', content: { type: 'codex', data: { type: 'message', message: 'Existing answer' } } }
        const message = store.messages.addMessage(session.id, content, 'old-answer', null, 300)
        store.close(); store = undefined
        const old = new Database(filename)
        old.exec(`
            ALTER TABLE messages DROP COLUMN content_revision;
            ALTER TABLE sessions DROP COLUMN content_revision;
            ALTER TABLE sessions DROP COLUMN read_revision;
            ALTER TABLE sessions DROP COLUMN read_state_version;
            ALTER TABLE sessions DROP COLUMN manual_unread;
            PRAGMA user_version = 46;
        `)
        old.close()

        store = new Store(filename)
        expect(store.sessions.getSession(session.id)).toMatchObject({
            lastUserMessageAt: userActivityAt, contentRevision: 0,
            readState: { readRevision: 0, manualUnread: false, version: 0 },
            metadata: { name: 'User title', nameLock: 'user', muted: true, readThrough: 400 }
        })
        expect(store.messages.getMessages(session.id)).toMatchObject([{ id: message.id, content, createdAt: 300 }])
        const next = store.messages.addMessage(session.id, content, 'new-answer')
        expect(next.contentRevision).toBe(1)
        expect(store.sessions.updateReadState(session.id, 'tenant', { type: 'unread', expectedVersion: 0 })?.status).toBe('ok')
        store.close(); store = undefined
        store = new Store(filename)
        expect(store.sessions.getSession(session.id)).toMatchObject({
            contentRevision: 1, readState: { readRevision: 0, manualUnread: true, version: 1 }
        })
    } finally { store?.close(); rmSync(directory, { recursive: true, force: true }) }
})
