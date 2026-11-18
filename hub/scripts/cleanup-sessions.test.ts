import { describe, expect, it } from 'bun:test'
import type { Database } from 'bun:sqlite'
import { Store } from '../src/store'
import { deleteSessions } from './cleanup-sessions'

function makeSession(store: Store, tag: string) {
    return store.sessions.getOrCreateSession(tag, { path: `/tmp/${tag}` }, null, 'default')
}

function failSessionDelete(store: Store): void {
    const db = (store as unknown as { db: Database }).db
    db.exec(`
        CREATE TRIGGER fail_session_delete
        BEFORE DELETE ON sessions
        BEGIN
            SELECT RAISE(ABORT, 'forced session delete failure');
        END
    `)
}

describe('cleanup session bulk deletion', () => {
    it('removes messages from search when their sessions are deleted', () => {
        const store = new Store(':memory:')
        const first = makeSession(store, 'cleanup-script-first')
        const second = makeSession(store, 'cleanup-script-second')
        for (const session of [first, second]) {
            store.messages.addMessage(session.id, {
                role: 'user',
                content: { type: 'text', text: 'cleanup script phrase' }
            })
        }

        const db = (store as unknown as { db: Database }).db
        expect(deleteSessions(db, [first.id, second.id])).toBe(2)
        expect(store.messages.searchMessages('cleanup script phrase').hits).toEqual([])
        expect(store.sessions.getSession(first.id)).toBeNull()
        expect(store.sessions.getSession(second.id)).toBeNull()
    })

    it('keeps sessions and their search hits when bulk deletion fails', () => {
        const store = new Store(':memory:')
        const first = makeSession(store, 'cleanup-script-rollback-first')
        const second = makeSession(store, 'cleanup-script-rollback-second')
        for (const session of [first, second]) {
            store.messages.addMessage(session.id, {
                role: 'user',
                content: { type: 'text', text: 'cleanup rollback phrase' }
            })
        }
        failSessionDelete(store)

        const db = (store as unknown as { db: Database }).db
        expect(() => deleteSessions(db, [first.id, second.id]))
            .toThrow('forced session delete failure')
        expect(store.messages.searchMessages('cleanup rollback phrase').hits).toHaveLength(2)
        expect(store.sessions.getSession(first.id)).not.toBeNull()
        expect(store.sessions.getSession(second.id)).not.toBeNull()
    })
})
