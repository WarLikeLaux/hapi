import { describe, expect, it } from 'bun:test'
import { mkdir, writeFile } from 'node:fs/promises'
import { mkdtempSync, rmSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ExternalConversation, ExternalMessage, MessengerConnection } from '@hapi/protocol'
import { Store } from '../store'
import type { SSEManager } from '../sse/sseManager'
import { MessengerManager } from './manager'
import type { MessengerConnector, MessengerConnectorEvent, MessengerConnectorFactory } from './types'

describe('MessengerManager', () => {
    it('refreshes history started after a send before publishing the conversation preview', async () => {
        const store = new Store(':memory:')
        const dataDir = mkdtempSync(join(tmpdir(), 'hapi-messenger-send-sync-'))
        const conversation: ExternalConversation = {
            id: 'test:user:1', provider: 'test', remoteId: 'user:1', title: 'Friend', kind: 'direct',
            selected: true, lastMessageAt: 1, lastMessagePreview: 'Old', unreadCount: 0
        }
        const oldMessage: ExternalMessage = {
            id: 'old', conversationId: conversation.id, providerMessageId: '1',
            senderId: 'peer', senderName: 'Friend', direction: 'incoming',
            text: 'Old', createdAt: 1, editedAt: null, media: []
        }
        const sentMessage: ExternalMessage = {
            ...oldMessage, id: 'sent', providerMessageId: '2', direction: 'outgoing',
            text: 'Test', createdAt: 2
        }
        const historyStarted = Promise.withResolvers<void>()
        const finishOldHistory = Promise.withResolvers<ExternalMessage[]>()
        const sent = Promise.withResolvers<void>()
        let loadCount = 0
        const connector: MessengerConnector = {
            provider: 'test',
            getConnection: () => ({ provider: 'test', state: 'ready', accountLabel: null, detail: null }),
            configure: async () => {}, submitAuth: async () => {}, listConversations: async () => [conversation],
            loadMessages: async () => {
                if (++loadCount === 1) {
                    historyStarted.resolve()
                    return finishOldHistory.promise
                }
                return [oldMessage, sentMessage]
            },
            sendText: async () => { sent.resolve() },
            setReactions: async () => {}, sendMedia: async () => {}, stop: async () => {},
            downloadMedia: async () => { throw new Error('No media') }
        }
        const manager = new MessengerManager({
            dataDir, store, sseManager: { broadcast: () => {} } as unknown as SSEManager
        })
        manager.registerConnectorFactory('test', () => connector)
        store.messengers.upsertConversation('default', conversation)
        store.messengers.upsertMessage('default', oldMessage)
        try {
            await manager.listMessages('default', conversation.id, { markRead: false })
            await historyStarted.promise
            const sending = manager.sendText('default', conversation.id, 'Test')
            await sent.promise
            finishOldHistory.resolve([oldMessage])
            await sending
            expect(manager.listConversations('default')[0]).toEqual(expect.objectContaining({
                lastMessageAt: 2, lastMessagePreview: 'Test', lastMessageDirection: 'outgoing'
            }))
            expect(await manager.listMessages('default', conversation.id, { markRead: false, refresh: false }))
                .toContainEqual(sentMessage)
        } finally {
            finishOldHistory.resolve([oldMessage])
            await manager.stop()
            store.close()
            rmSync(dataDir, { recursive: true, force: true })
        }
    })

    it('re-runs configure from the error state once backoff has elapsed', async () => {
        const dataDir = mkdtempSync(join(tmpdir(), 'hapi-messenger-configure-retry-'))
        const store = new Store(':memory:')
        const namespaceHash = createHash('sha256').update('default').digest('hex').slice(0, 24)
        const providerDir = join(dataDir, 'messengers', namespaceHash, 'telegram')
        await mkdir(providerDir, { recursive: true })
        await writeFile(join(providerDir, 'config.json'), JSON.stringify({ apiId: 1, apiHash: 'hash' }))

        let state: MessengerConnection['state'] = 'error'
        let configureCalls = 0
        const connector: MessengerConnector = {
            provider: 'telegram',
            getConnection: () => ({ provider: 'telegram', state, accountLabel: null, detail: null }),
            configure: async () => {
                configureCalls += 1
                state = 'ready'
            },
            submitAuth: async () => {}, listConversations: async () => [], loadMessages: async () => [],
            downloadMedia: async () => ({ path: '/tmp/media', mimeType: 'image/jpeg', fileName: 'photo.jpg', size: 1 }),
            sendText: async () => {}, setReactions: async () => {}, sendMedia: async () => {}, stop: async () => {}
        }
        const manager = new MessengerManager({
            dataDir, store, sseManager: { broadcast: () => {} } as unknown as SSEManager
        })
        const factories = (manager as unknown as { factories: Map<string, MessengerConnectorFactory> }).factories
        factories.set('telegram', () => connector)
        const backoff = (manager as unknown as {
            configureBackoff: Map<string, { lastAt: number; attempts: number }>
        }).configureBackoff
        backoff.set('default\0telegram', { lastAt: Date.now() - 300_000, attempts: 3 })

        try {
            await manager.listCandidates('default', 'telegram', true)
            expect(configureCalls).toBe(1)
            expect(connector.getConnection().state).toBe('ready')
        } finally {
            await manager.stop()
            store.close()
            rmSync(dataDir, { recursive: true, force: true })
        }
    })

    it('skips the configure retry while the error backoff is still running', async () => {
        const dataDir = mkdtempSync(join(tmpdir(), 'hapi-messenger-configure-backoff-'))
        const store = new Store(':memory:')
        const namespaceHash = createHash('sha256').update('default').digest('hex').slice(0, 24)
        const providerDir = join(dataDir, 'messengers', namespaceHash, 'telegram')
        await mkdir(providerDir, { recursive: true })
        await writeFile(join(providerDir, 'config.json'), JSON.stringify({ apiId: 1, apiHash: 'hash' }))

        let configureCalls = 0
        const connector: MessengerConnector = {
            provider: 'telegram',
            getConnection: () => ({ provider: 'telegram', state: 'error', accountLabel: null, detail: null }),
            configure: async () => {
                configureCalls += 1
            },
            submitAuth: async () => {}, listConversations: async () => [], loadMessages: async () => [],
            downloadMedia: async () => ({ path: '/tmp/media', mimeType: 'image/jpeg', fileName: 'photo.jpg', size: 1 }),
            sendText: async () => {}, setReactions: async () => {}, sendMedia: async () => {}, stop: async () => {}
        }
        const manager = new MessengerManager({
            dataDir, store, sseManager: { broadcast: () => {} } as unknown as SSEManager
        })
        const factories = (manager as unknown as { factories: Map<string, MessengerConnectorFactory> }).factories
        factories.set('telegram', () => connector)
        const backoff = (manager as unknown as {
            configureBackoff: Map<string, { lastAt: number; attempts: number }>
        }).configureBackoff
        backoff.set('default\0telegram', { lastAt: Date.now(), attempts: 1 })

        try {
            await manager.listCandidates('default', 'telegram', true)
            expect(configureCalls).toBe(0)
        } finally {
            await manager.stop()
            store.close()
            rmSync(dataDir, { recursive: true, force: true })
        }
    })

    it('returns cached candidates immediately and refreshes them in the background', async () => {
        const dataDir = mkdtempSync(join(tmpdir(), 'hapi-messenger-candidate-cache-'))
        const store = new Store(':memory:')
        let resolveRemote!: (value: ExternalConversation[]) => void
        const remote = new Promise<ExternalConversation[]>((resolve) => { resolveRemote = resolve })
        const cached: ExternalConversation = {
            id: 'test:user:1', provider: 'test', remoteId: 'user:1', title: 'Cached', kind: 'direct',
            selected: false, lastMessageAt: 1, lastMessagePreview: null, unreadCount: 0, avatarDataUrl: null
        }
        const connector: MessengerConnector = {
            provider: 'test',
            getConnection: () => ({ provider: 'test', state: 'ready', accountLabel: null, detail: null }),
            configure: async () => {}, submitAuth: async () => {}, listConversations: async () => await remote,
            loadMessages: async () => [],
            downloadMedia: async () => ({ path: '/tmp/media', mimeType: 'image/jpeg', fileName: 'photo.jpg', size: 1 }),
            sendText: async () => {}, setReactions: async () => {}, sendMedia: async () => {}, stop: async () => {}
        }
        const manager = new MessengerManager({
            dataDir, store, sseManager: { broadcast: () => {} } as unknown as SSEManager
        })
        manager.registerConnectorFactory('test', () => connector)
        store.messengers.upsertConversation('default', cached)

        try {
            const result = await Promise.race([
                manager.listCandidates('default', 'test'),
                new Promise<'timed-out'>((resolve) => setTimeout(() => resolve('timed-out'), 50))
            ])
            expect(result).toEqual([expect.objectContaining({ id: cached.id, title: 'Cached' })])
            resolveRemote([{ ...cached, title: 'Fresh' }])
            await manager.listCandidates('default', 'test', true)
            expect((await manager.listCandidates('default', 'test'))[0]?.title).toBe('Fresh')
        } finally {
            resolveRemote([])
            await manager.stop()
            store.close()
            rmSync(dataDir, { recursive: true, force: true })
        }
    })

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
            sendText: async () => {}, setReactions: async () => {}, sendMedia: async () => {}, stop: async () => {}
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
            sendText: async () => {}, setReactions: async () => {}, sendMedia: async () => {}, stop: async () => {}
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

            emit!({
                type: 'message-reactions',
                provider: 'test',
                remoteId: 'user:1',
                providerMessageId: '5',
                reactions: [{ reaction: 'emoji:👍', emoji: '👍', count: 2, chosen: true }]
            })

            expect(store.messengers.listMessages('default', conversation.id)[0]?.reactions).toEqual([
                { reaction: 'emoji:👍', emoji: '👍', count: 2, chosen: true }
            ])

            store.messengers.setUnreadCount('default', conversation.id, 3)
            emit!({ type: 'inbox-read', provider: 'test', remoteId: 'user:1', unreadCount: 1 })
            expect(store.messengers.getConversation('default', conversation.id)?.unreadCount).toBe(1)
            expect(events).toContainEqual({
                type: 'external-conversation-updated',
                namespace: 'default',
                conversationId: conversation.id
            })
        } finally {
            await manager.stop()
            store.close()
            rmSync(dataDir, { recursive: true, force: true })
        }
    })

    it('presses a callback button through the connector and refreshes the message', async () => {
        const dataDir = mkdtempSync(join(tmpdir(), 'hapi-messenger-button-press-'))
        const store = new Store(':memory:')
        const conversation: ExternalConversation = {
            id: 'test:user:1', provider: 'test', remoteId: 'user:1', title: 'Bot', kind: 'direct',
            selected: false, lastMessageAt: 5, lastMessagePreview: 'choose', unreadCount: 0, avatarDataUrl: null
        }
        const presses: Array<[string, string]> = []
        const buttonMessage: ExternalMessage = {
            id: 'test:user:1:5', conversationId: conversation.id, providerMessageId: '5',
            senderId: 'user:1', senderName: 'Bot', direction: 'incoming',
            text: 'choose', createdAt: 5, editedAt: null, media: [],
            buttons: [[
                { id: '0:0', text: 'Next', kind: 'callback' },
                { id: '0:1', text: 'Open', kind: 'url', url: 'https://example.com' }
            ]]
        }
        const connector: MessengerConnector = {
            provider: 'test',
            getConnection: (): MessengerConnection => ({ provider: 'test', state: 'ready', accountLabel: null, detail: null }),
            configure: async () => {}, submitAuth: async () => {}, listConversations: async () => [conversation],
            // The post-press refresh reconciles against this snapshot, so it must
            // still carry the message.
            loadMessages: async () => [buttonMessage],
            downloadMedia: async () => ({ path: '/tmp/media', mimeType: 'image/jpeg', fileName: 'photo.jpg', size: 1 }),
            sendText: async () => {}, setReactions: async () => {}, sendMedia: async () => {}, stop: async () => {},
            pressButton: async (remoteId, providerMessageId, buttonId) => {
                presses.push([providerMessageId, buttonId])
                return { message: 'Loading…' }
            }
        }
        const manager = new MessengerManager({
            dataDir,
            store,
            sseManager: { broadcast: () => {} } as unknown as SSEManager
        })
        manager.registerConnectorFactory('test', () => connector)

        try {
            await manager.getConnections('default')
            store.messengers.upsertConversation('default', conversation)
            store.messengers.replaceSelection('default', 'test', [conversation.remoteId])
            store.messengers.upsertMessage('default', buttonMessage)

            const result = await manager.pressMessageButton('default', conversation.id, '5', '0:0')
            expect(result).toEqual({ message: 'Loading…' })
            expect(presses).toEqual([['5', '0:0']])

            await expect(manager.pressMessageButton('default', conversation.id, '5', '0:1'))
                .rejects.toThrow('Button not found')
            await expect(manager.pressMessageButton('default', conversation.id, '5', '9:9'))
                .rejects.toThrow('Button not found')
            await expect(manager.pressMessageButton('default', conversation.id, '404', '0:0'))
                .rejects.toThrow('Message not found')
        } finally {
            await manager.stop()
            store.close()
            rmSync(dataDir, { recursive: true, force: true })
        }
    })

    it('marks Telegram history read remotely before keeping the local unread count cleared', async () => {
        const dataDir = mkdtempSync(join(tmpdir(), 'hapi-messenger-mark-read-'))
        const store = new Store(':memory:')
        const calls: Array<[string, number, { seqNo: number; version: number } | undefined]> = []
        const conversation: ExternalConversation = {
            id: 'test:user:1', provider: 'test', remoteId: 'user:1', title: 'Friend', kind: 'direct',
            selected: false, lastMessageAt: 9, lastMessagePreview: 'Unread', unreadCount: 2, avatarDataUrl: null
        }
        const connector: MessengerConnector = {
            provider: 'test',
            getConnection: () => ({ provider: 'test', state: 'ready', accountLabel: null, detail: null }),
            configure: async () => {}, submitAuth: async () => {}, listConversations: async () => [conversation],
            loadMessages: async () => [],
            markRead: async (remoteId, maxProviderMessageId, cursor) => { calls.push([remoteId, maxProviderMessageId, cursor]) },
            downloadMedia: async () => ({ path: '/tmp/media', mimeType: 'image/jpeg', fileName: 'photo.jpg', size: 1 }),
            sendText: async () => {}, setReactions: async () => {}, sendMedia: async () => {}, stop: async () => {}
        }
        const manager = new MessengerManager({
            dataDir, store, sseManager: { broadcast: () => {} } as unknown as SSEManager
        })
        manager.registerConnectorFactory('test', () => connector)
        store.messengers.upsertConversation('default', conversation)
        store.messengers.replaceSelection('default', 'test', [conversation.remoteId])
        store.messengers.upsertMessage('default', {
            id: 'test:user:1:9', conversationId: conversation.id, providerMessageId: '9',
            senderId: 'user:1', senderName: 'Friend', direction: 'incoming',
            text: 'Unread', createdAt: 9, editedAt: null, media: []
        })

        try {
            await manager.listMessages('default', conversation.id, { refresh: false })
            expect(calls).toEqual([['user:1', 9, undefined]])
            expect(store.messengers.getConversation('default', conversation.id)?.unreadCount).toBe(0)
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
            setReactions: async () => {},
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
            sendText: async () => {}, setReactions: async () => {}, sendMedia: async () => {}, stop: async () => {}
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
            sendText: async () => {}, setReactions: async () => {}, sendMedia: async () => {}, stop: async () => {}
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

    it('passes reply targets to the connector and rejects unknown ones', async () => {
        const dataDir = mkdtempSync(join(tmpdir(), 'hapi-messenger-reply-to-'))
        const store = new Store(':memory:')
        const conversation: ExternalConversation = {
            id: 'test:user:1', provider: 'test', remoteId: 'user:1', title: 'Friend', kind: 'direct',
            selected: false, lastMessageAt: 1, lastMessagePreview: 'Original', unreadCount: 0, avatarDataUrl: null
        }
        const original: ExternalMessage = {
            id: 'test:user:1:7', conversationId: conversation.id, providerMessageId: '7',
            senderId: 'user:1', senderName: 'Friend', direction: 'incoming', text: 'Original',
            createdAt: 1, editedAt: null
        }
        const sentTexts: Array<{ remoteId: string; text: string; clientId?: string; replyToProviderMessageId?: string }> = []
        const connector: MessengerConnector = {
            provider: 'test',
            getConnection: (): MessengerConnection => ({ provider: 'test', state: 'ready', accountLabel: null, detail: null }),
            configure: async () => {}, submitAuth: async () => {},
            listConversations: async () => [conversation],
            loadMessages: async () => [original],
            downloadMedia: async () => ({ path: '/tmp/media', mimeType: 'image/jpeg', fileName: 'photo.jpg', size: 1 }),
            sendText: async (remoteId, text, clientId, replyToProviderMessageId) => {
                sentTexts.push({ remoteId, text, clientId, replyToProviderMessageId })
            },
            setReactions: async () => {}, sendMedia: async () => {}, stop: async () => {}
        }
        const manager = new MessengerManager({
            dataDir,
            store,
            sseManager: { broadcast: () => {} } as unknown as SSEManager
        })
        manager.registerConnectorFactory('test', () => connector)

        try {
            await manager.selectConversations('default', 'test', ['user:1'])
            // Seed the store directly: listMessages only kicks a background
            // refresh, so the reply target may not be persisted yet otherwise.
            store.messengers.upsertMessage('default', original)
            await manager.sendText('default', conversation.id, 'Ответ', undefined, '7')
            expect(sentTexts).toEqual([
                expect.objectContaining({ text: 'Ответ', replyToProviderMessageId: '7' })
            ])

            await expect(manager.sendText('default', conversation.id, 'Ответ', undefined, '999'))
                .rejects.toThrow('Message not found')
            expect(sentTexts).toHaveLength(1)
        } finally {
            await manager.stop()
            store.close()
            rmSync(dataDir, { recursive: true, force: true })
        }
    })
})
