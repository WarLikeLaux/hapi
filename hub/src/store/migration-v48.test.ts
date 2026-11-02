import { expect, it } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Store } from '.'

it('upgrades v47 groups without losing their members', () => {
    const directory = mkdtempSync(join(tmpdir(), 'hapi-groups-v47-'))
    const filename = join(directory, 'hub.sqlite')
    let store: Store | undefined
    try {
        store = new Store(filename)
        const session = store.sessions.getOrCreateSession('legacy', { path: '/workspace' }, null, 'default')
        const group = store.groups.create('default', 'Existing group')
        store.groups.update('default', group.id, { name: group.name, version: group.version, members: [{ sessionId: session.id, pinned: true }] })
        store.close(); store = undefined
        const old = new Database(filename)
        old.exec('ALTER TABLE session_groups DROP COLUMN pinned; PRAGMA user_version = 47')
        old.close()

        store = new Store(filename)
        expect(store.groups.list('default')).toMatchObject([{ id: group.id, name: group.name, pinned: false, members: [{ sessionId: session.id, pinned: true }] }])
    } finally { store?.close(); rmSync(directory, { recursive: true, force: true }) }
})
