import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { MessengerManager } from '../../messengers/manager'
import type { WebAppEnv } from '../middleware/auth'
import { createMessengerRoutes } from './messengers'

describe('messenger routes', () => {
    it('sets the complete chosen reaction list for a message', async () => {
        const calls: unknown[][] = []
        const manager = {
            setReactions: async (...args: unknown[]) => { calls.push(args) }
        } as unknown as MessengerManager
        const app = new Hono<WebAppEnv>()
        app.use('*', async (c, next) => {
            c.set('namespace', 'default')
            await next()
        })
        app.route('/', createMessengerRoutes(manager))

        const response = await app.request('/conversations/chat/messages/42/reactions', {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ reactions: ['emoji:👍', 'custom:7'] })
        })

        expect(response.status).toBe(200)
        expect(calls).toEqual([['default', 'chat', '42', ['emoji:👍', 'custom:7']]])
    })

    it('supports cached and forced candidate refreshes', async () => {
        const calls: unknown[][] = []
        const manager = {
            listCandidates: async (...args: unknown[]) => {
                calls.push(args)
                return []
            }
        } as unknown as MessengerManager
        const app = new Hono<WebAppEnv>()
        app.use('*', async (c, next) => {
            c.set('namespace', 'default')
            await next()
        })
        app.route('/', createMessengerRoutes(manager))

        expect((await app.request('/messengers/telegram/candidates')).status).toBe(200)
        expect((await app.request('/messengers/telegram/candidates?refresh=true')).status).toBe(200)
        expect(calls).toEqual([
            ['default', 'telegram', false],
            ['default', 'telegram', true]
        ])
    })

    it('updates local aliases for chats and participants', async () => {
        const calls: unknown[][] = []
        const manager = {
            setConversationAlias: (...args: unknown[]) => {
                calls.push(args)
                return { id: 'chat', title: 'Family' }
            },
            setParticipantAlias: (...args: unknown[]) => {
                calls.push(args)
                return { id: 'user:1', name: 'Sis' }
            }
        } as unknown as MessengerManager
        const app = new Hono<WebAppEnv>()
        app.use('*', async (c, next) => {
            c.set('namespace', 'default')
            await next()
        })
        app.route('/', createMessengerRoutes(manager))

        const chat = await app.request('/conversations/chat/alias', {
            method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Family' })
        })
        const person = await app.request('/conversations/chat/participants/user%3A1/alias', {
            method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Sis' })
        })

        expect(chat.status).toBe(200)
        expect(person.status).toBe(200)
        expect(calls).toEqual([
            ['default', 'chat', 'Family'],
            ['default', 'chat', 'user:1', 'Sis']
        ])
    })

    it('starts configured connectors when the global conversation list is requested', async () => {
        const calls: string[] = []
        const manager = {
            getConnections: async (namespace: string) => {
                calls.push(`connect:${namespace}`)
                return []
            },
            listConversations: (namespace: string) => {
                calls.push(`list:${namespace}`)
                return []
            },
        } as unknown as MessengerManager
        const app = new Hono<WebAppEnv>()
        app.use('*', async (c, next) => {
            c.set('namespace', 'default')
            await next()
        })
        app.route('/', createMessengerRoutes(manager))

        const response = await app.request('/conversations')

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ conversations: [] })
        expect(calls).toEqual(['connect:default', 'list:default'])
    })

    it('returns participant avatars separately from messages', async () => {
        const calls: unknown[][] = []
        const manager = {
            listMessages: async (...args: unknown[]) => {
                calls.push(args)
                return [{
                    id: 'message-1',
                    conversationId: 'telegram:group:1',
                    providerMessageId: '1',
                    senderId: 'user-1',
                    senderName: 'Alice',
                    direction: 'incoming',
                    text: 'Hello',
                    createdAt: 1,
                    editedAt: null,
                }]
            },
            listParticipants: () => [{
                id: 'user-1',
                name: 'Alice',
                avatarDataUrl: 'data:image/jpeg;base64,dGVzdA==',
            }],
        } as unknown as MessengerManager
        const app = new Hono<WebAppEnv>()
        app.use('*', async (c, next) => {
            c.set('namespace', 'default')
            await next()
        })
        app.route('/', createMessengerRoutes(manager))

        const response = await app.request('/conversations/telegram%3Agroup%3A1/messages')

        expect(response.status).toBe(200)
        expect(calls).toEqual([[
            'default',
            'telegram:group:1',
            { markRead: true, refresh: true }
        ]])
        expect(await response.json()).toEqual({
            messages: [{
                id: 'message-1',
                conversationId: 'telegram:group:1',
                providerMessageId: '1',
                senderId: 'user-1',
                senderName: 'Alice',
                direction: 'incoming',
                text: 'Hello',
                createdAt: 1,
                editedAt: null,
            }],
            participants: [{
                id: 'user-1',
                name: 'Alice',
                avatarDataUrl: 'data:image/jpeg;base64,dGVzdA==',
            }],
        })
    })

    it('can read only the local message snapshot without marking a chat as read', async () => {
        const calls: unknown[][] = []
        const manager = {
            listMessages: async (...args: unknown[]) => {
                calls.push(args)
                return []
            },
            listParticipants: () => [],
        } as unknown as MessengerManager
        const app = new Hono<WebAppEnv>()
        app.use('*', async (c, next) => {
            c.set('namespace', 'default')
            await next()
        })
        app.route('/', createMessengerRoutes(manager))

        const response = await app.request('/conversations/chat/messages?markRead=false&refresh=false')

        expect(response.status).toBe(200)
        expect(calls).toEqual([['default', 'chat', { markRead: false, refresh: false }]])
    })

    it('serves media whose Telegram filename contains non-ASCII characters', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'hapi-messenger-route-'))
        const path = join(directory, 'animation.mp4')
        await Bun.write(path, 'video-bytes')
        const manager = {
            downloadMedia: async () => ({
                path,
                mimeType: 'video/mp4',
                fileName: 'pig-свинья.mp4',
                size: 11,
            }),
        } as unknown as MessengerManager
        const app = new Hono<WebAppEnv>()
        app.use('*', async (c, next) => {
            c.set('namespace', 'default')
            await next()
        })
        app.route('/', createMessengerRoutes(manager))

        try {
            const response = await app.request('/conversations/telegram%3Auser%3A1/messages/2/media/0')

            expect(response.status).toBe(200)
            expect(response.headers.get('content-type')).toBe('video/mp4')
            expect(response.headers.get('content-disposition')).toBe(
                'inline; filename="pig-______.mp4"; filename*=UTF-8\'\'pig-%D1%81%D0%B2%D0%B8%D0%BD%D1%8C%D1%8F.mp4'
            )
            expect(await response.text()).toBe('video-bytes')
        } finally {
            await rm(directory, { recursive: true, force: true })
        }
    })
})
