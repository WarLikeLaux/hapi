import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { MessengerManager } from '../../messengers/manager'
import type { WebAppEnv } from '../middleware/auth'
import { createMessengerRoutes } from './messengers'

describe('messenger routes', () => {
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
