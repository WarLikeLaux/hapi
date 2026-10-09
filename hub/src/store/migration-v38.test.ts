import { describe, expect, it } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Store } from './index'

describe('messenger presentation migration', () => {
    it('preserves old history and new forward/link metadata across reopen and replacement', () => {
        const dir = mkdtempSync(join(tmpdir(), 'hapi-forward-migration-'))
        const path = join(dir, 'hapi.db')
        let store: Store | undefined
        const conversation = {
            id: 'telegram:user:1', provider: 'telegram', remoteId: 'user:1', title: 'Friend',
            kind: 'direct' as const, selected: true, lastMessageAt: null, lastMessagePreview: null, unreadCount: 0
        }
        const message = {
            id: 'telegram:user:1:1', conversationId: conversation.id, providerMessageId: '1',
            senderId: 'user:1', senderName: 'Friend', direction: 'incoming' as const,
            text: 'Отсюда', createdAt: 1000, editedAt: null
        }
        try {
            store = new Store(path)
            store.messengers.upsertConversation('one', conversation)
            store.messengers.upsertMessage('one', message)
            store.close()
            const db = new Database(path)
            db.exec('ALTER TABLE external_messages DROP COLUMN presentation_json; PRAGMA user_version = 37;')
            db.close()

            store = new Store(path)
            expect(store.messengers.listMessages('one', conversation.id)[0]?.text).toBe('Отсюда')
            const presentation = {
                forward: { sourceName: 'Channel', sourceUrl: 'https://t.me/channel/1', author: 'Author' },
                linkPreview: { url: 'https://example.com/story', title: 'Article', description: 'Summary' },
                textLinks: [{ offset: 0, length: 6, url: 'https://example.com/story' }]
            }
            store.messengers.upsertMessage('one', { ...message, ...presentation })
            store.close()
            store = new Store(path)
            expect(store.messengers.listMessages('one', conversation.id)[0]).toMatchObject(presentation)
            expect(store.messengers.listMessages('other', conversation.id)).toEqual([])
            store.messengers.upsertMessage('one', { ...message, text: 'Edited without preview' })
            const replaced = store.messengers.listMessages('one', conversation.id)[0]
            expect(replaced?.text).toBe('Edited without preview')
            expect(replaced?.forward).toBeUndefined()
            expect(replaced?.linkPreview).toBeUndefined()
            expect(replaced?.textLinks).toBeUndefined()
        } finally {
            store?.close()
            rmSync(dir, { recursive: true, force: true })
        }
    })
})
