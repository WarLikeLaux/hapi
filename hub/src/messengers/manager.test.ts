import { describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ExternalConversation, ExternalMessage, MessengerConnection } from '@hapi/protocol'
import { Store } from '../store'
import type { SSEManager } from '../sse/sseManager'
import { MessengerManager } from './manager'
import type { MessengerConnector, MessengerConnectorEvent } from './types'

describe('MessengerManager', () => {
    it('keeps an already selected Telegram channel in the chat list', () => {
        const store = new Store(':memory:')
        const manager = new MessengerManager({
            dataDir: tmpdir(),
            store,
            sseManager: { broadcast: () => {} } as unknown as SSEManager
        })
        store.messengers.upsertConversation('default', {
            id: 'telegram:channel:1',
            provider: 'telegram',
            remoteId: 'channel:1',
            title: 'News channel',
            kind: 'channel',
            selected: false,
            lastMessageAt: 1,
            lastMessagePreview: 'News',
            unreadCount: 0,
            avatarDataUrl: null
        })
        store.messengers.replaceSelection('default', 'telegram', ['channel:1'])

        expect(manager.listConversations('default')).toEqual([
            expect.objectContaining({ id: 'telegram:channel:1', selected: true })
        ])
        store.close()
    })

    it('preserves an existing channel when saving a new selectable-chat list', async () => {
        const dataDir = mkdtempSync(join(tmpdir(), 'hapi-messenger-channel-'))
        const store = new Store(':memory:')
        const direct: ExternalConversation = {
            id: 'test:user:1', provider: 'test', remoteId: 'user:1', title: 'Friend', kind: 'direct',
            selected: false, lastMessageAt: 2, lastMessagePreview: 'Hi', unreadCount: 0, avatarDataUrl: null
        }
        const channel: ExternalConversation = {
            id: 'test:channel:1', provider: 'test', remoteId: 'channel:1', title: 'My channel', kind: 'channel',
            selected: false, lastMessageAt: 1, lastMessagePreview: 'Post', unreadCount: 0, avatarDataUrl: null
        }
        const connector: MessengerConnector = {
            provider: 'test',
            getConnection: () => ({ provider: 'test', state: 'ready', accountLabel: null, detail: null }),
            configure: async () => {}, submitAuth: async () => {},
            listConversations: async () => [direct, channel], loadMessages: async () => [],
            downloadMedia: async () => ({ path: '/tmp/media', mimeType: 'image/jpeg', fileName: 'photo.jpg', size: 1 }),
            sendText: async () => {}, sendMedia: async () => {}, stop: async () => {}
        }
        const manager = new MessengerManager({
            dataDir, store, sseManager: { broadcast: () => {} } as unknown as SSEManager
        })
        manager.registerConnectorFactory('test', () => connector)
        store.messengers.upsertConversation('default', channel)
        store.messengers.replaceSelection('default', 'test', [channel.remoteId])

        try {
            await manager.selectConversations('default', 'test', [direct.remoteId])
            expect(manager.listConversations('default').map((item) => item.remoteId).sort()).toEqual([
                channel.remoteId,
                direct.remoteId
            ])
        } finally {
            await manager.stop()
            store.close()
            rmSync(dataDir, { recursive: true, force: true })
        }
    })

    it('applies live outgoing read receipts and broadcasts a message update', async () => {
        const dataDir = mkdtempSync(join(tmpdir(), 'hapi-messenger-read-receipt-'))
        const store = new Store(':memory:')
        const events: Array<{ type?: string; conversationId?: string; namespace?: string }> = []
        const conversation: ExternalConversation = {
            id: 'test:user:1', provider: 'test', remoteId: 'user:1', title: 'Friend', kind: 'direct',
            selected: false, lastMessageAt: 5, lastMessagePreview: 'Hello', unreadCount: 0, avatarDataUrl: null
        }
        let emit: ((event: MessengerConnectorEvent) => void) | null = null
        const connector: MessengerConnector = {
            provider: 'test',
            getConnection: (): MessengerConnection => ({ provider: 'test', state: 'ready', accountLabel: null, detail: null }),
            configure: async () => {}, submitAuth: async () => {}, listConversations: async () => [conversation],
            loadMessages: async () => [],
            downloadMedia: async () => ({ path: '/tmp/media', mimeType: 'image/jpeg', fileName: 'photo.jpg', size: 1 }),
            sendText: async () => {}, sendMedia: async () => {}, stop: async () => {}
        }
        const manager = new MessengerManager({
            dataDir,
            store,
            sseManager: { broadcast: (event: { type?: string; conversationId?: string; namespace?: string }) => events.push(event) } as unknown as SSEManager
        })
        manager.registerConnectorFactory('test', (options) => {
            emit = options.onEvent
            return connector
        })

        try {
            await manager.getConnections('default')
            store.messengers.upsertConversation('default', conversation)
            store.messengers.replaceSelection('default', 'test', [conversation.remoteId])
            store.messengers.upsertMessage('default', {
                id: 'test:user:1:5', conversationId: conversation.id, providerMessageId: '5',
                senderId: 'user:me', senderName: 'Me', direction: 'outgoing', deliveryStatus: 'sent',
                text: 'Hello', createdAt: 5, editedAt: null, media: []
            })

            emit!({ type: 'messages-read', provider: 'test', remoteId: 'user:1', maxProviderMessageId: 5 })

            expect(store.messengers.listMessages('default', conversation.id)[0]?.deliveryStatus).toBe('read')
            expect(events).toContainEqual({
                type: 'external-message-updated',
                namespace: 'default',
                conversationId: conversation.id
            })
        } finally {
            await manager.stop()
            store.close()
            rmSync(dataDir, { recursive: true, force: true })
        }
    })

    it('warms selected chats and prefetches recent media in the background', async () => {
        const dataDir = mkdtempSync(join(tmpdir(), 'hapi-messenger-manager-'))
        const store = new Store(':memory:')
        const events: unknown[] = []
        let loadCount = 0
        let requestedLimit = 0
        let downloadCount = 0
        let resolvePrefetched!: () => void
        const prefetched = new Promise<void>((resolve) => { resolvePrefetched = resolve })
        const conversation: ExternalConversation = {
            id: 'test:user:1',
            provider: 'test',
            remoteId: 'user:1',
            title: 'Friend',
            kind: 'direct',
            selected: false,
            lastMessageAt: 1,
            lastMessagePreview: 'Hello',
            unreadCount: 0,
            avatarDataUrl: null
        }
        const message: ExternalMessage = {
            id: 'test:user:1:1',
            conversationId: conversation.id,
            providerMessageId: '1',
            senderId: 'user:1',
            senderName: 'Friend',
            direction: 'incoming',
            text: 'Hello',
            createdAt: 1,
            editedAt: null,
            media: [{
                kind: 'image', mimeType: 'image/jpeg', fileName: null,
                size: 128, thumbnailDataUrl: null
            }]
        }
        const connector: MessengerConnector = {
            provider: 'test',
            getConnection: (): MessengerConnection => ({ provider: 'test', state: 'ready', accountLabel: null, detail: null }),
            configure: async () => {},
            submitAuth: async () => {},
            listConversations: async () => [conversation],
            loadMessages: async (_remoteId, limit) => {
                loadCount += 1
                requestedLimit = limit ?? 0
                return [message]
            },
            downloadMedia: async () => {
                downloadCount += 1
                resolvePrefetched()
                return { path: '/tmp/media', mimeType: 'image/jpeg', fileName: 'photo.jpg', size: 1 }
            },
            sendText: async () => {},
            sendMedia: async () => {},
            stop: async () => {}
        }
        const manager = new MessengerManager({
            dataDir,
            store,
            sseManager: { broadcast: (event: unknown) => events.push(event) } as unknown as SSEManager
        })
        manager.registerConnectorFactory('test', () => connector)

        try {
            await manager.selectConversations('default', 'test', ['user:1'])
            await Promise.race([
                prefetched,
                new Promise<never>((_, reject) => setTimeout(() => reject(new Error('media was not prefetched')), 1000))
            ])
            expect(loadCount).toBe(1)
            expect(downloadCount).toBe(1)
            expect(requestedLimit).toBe(100)

            expect(await manager.listMessages('default', conversation.id)).toEqual([message])
            expect(loadCount).toBe(1)
        } finally {
            await manager.stop()
            store.close()
            rmSync(dataDir, { recursive: true, force: true })
        }
    })

    it('returns an empty local snapshot immediately while the first refresh runs in the background', async () => {
        const dataDir = mkdtempSync(join(tmpdir(), 'hapi-messenger-cache-first-'))
        const store = new Store(':memory:')
        let resolveLoad!: (messages: ExternalMessage[]) => void
        const load = new Promise<ExternalMessage[]>((resolve) => { resolveLoad = resolve })
        let resolveRefreshed!: () => void
        const refreshed = new Promise<void>((resolve) => { resolveRefreshed = resolve })
        const conversation: ExternalConversation = {
            id: 'test:user:1', provider: 'test', remoteId: 'user:1', title: 'Friend', kind: 'direct',
            selected: false, lastMessageAt: 1, lastMessagePreview: 'Hello', unreadCount: 0, avatarDataUrl: null
        }
        const connector: MessengerConnector = {
            provider: 'test',
            getConnection: (): MessengerConnection => ({ provider: 'test', state: 'ready', accountLabel: null, detail: null }),
            configure: async () => {}, submitAuth: async () => {}, listConversations: async () => [conversation],
            loadMessages: async () => await load,
            downloadMedia: async () => ({ path: '/tmp/media', mimeType: 'image/jpeg', fileName: 'photo.jpg', size: 1 }),
            sendText: async () => {}, sendMedia: async () => {}, stop: async () => {}
        }
        const manager = new MessengerManager({
            dataDir,
            store,
            sseManager: {
                broadcast: (event: { type?: string }) => {
                    if (event.type === 'external-message-received') resolveRefreshed()
                }
            } as unknown as SSEManager
        })
        manager.registerConnectorFactory('test', () => connector)
        store.messengers.upsertConversation('default', conversation)
        store.messengers.replaceSelection('default', 'test', [conversation.remoteId])

        try {
            const result = await Promise.race([
                manager.listMessages('default', conversation.id),
                new Promise<'timed-out'>((resolve) => setTimeout(() => resolve('timed-out'), 50))
            ])
            expect(result).toEqual([])
        } finally {
            resolveLoad([])
            await refreshed
            await manager.stop()
            store.close()
            rmSync(dataDir, { recursive: true, force: true })
        }
    })

    it('backs off the media prefetch queue when Telegram returns FLOOD_WAIT', async () => {
        const dataDir = mkdtempSync(join(tmpdir(), 'hapi-messenger-flood-wait-'))
        const store = new Store(':memory:')
        let downloadCount = 0
        const conversation: ExternalConversation = {
            id: 'test:user:1', provider: 'test', remoteId: 'user:1', title: 'Friend', kind: 'direct',
            selected: false, lastMessageAt: 1, lastMessagePreview: 'Media', unreadCount: 0, avatarDataUrl: null
        }
        const message: ExternalMessage = {
            id: 'test:user:1:1', conversationId: conversation.id, providerMessageId: '1',
            senderId: 'user:1', senderName: 'Friend', direction: 'incoming', text: '',
            createdAt: 1, editedAt: null,
            media: [
                { kind: 'image', mimeType: 'image/jpeg', fileName: null, size: 128, thumbnailDataUrl: null },
                { kind: 'image', mimeType: 'image/jpeg', fileName: null, size: 128, thumbnailDataUrl: null }
            ]
        }
        const connector: MessengerConnector = {
            provider: 'test',
            getConnection: (): MessengerConnection => ({ provider: 'test', state: 'ready', accountLabel: null, detail: null }),
            configure: async () => {}, submitAuth: async () => {},
            listConversations: async () => [conversation],
            loadMessages: async () => [message],
            downloadMedia: async () => {
                downloadCount += 1
                throw new Error('rpcDoRequest: rpc error code 420: FLOOD_WAIT (2)')
            },
            sendText: async () => {}, sendMedia: async () => {}, stop: async () => {}
        }
        const manager = new MessengerManager({
            dataDir,
            store,
            sseManager: { broadcast: () => {} } as unknown as SSEManager
        })
        manager.registerConnectorFactory('test', () => connector)

        try {
            await manager.selectConversations('default', 'test', ['user:1'])
            await new Promise((resolve) => setTimeout(resolve, 100))
            expect(downloadCount).toBe(1)
        } finally {
            await manager.stop()
            store.close()
            rmSync(dataDir, { recursive: true, force: true })
        }
    })
})
