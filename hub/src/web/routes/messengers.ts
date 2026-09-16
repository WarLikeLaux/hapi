import {
    ConfigureTelegramRequestSchema,
    SelectMessengerConversationsRequestSchema,
    SendExternalMessageRequestSchema,
    SubmitMessengerAuthRequestSchema
} from '@hapi/protocol'
import { Hono } from 'hono'
import type { MessengerManager } from '../../messengers/manager'
import type { WebAppEnv } from '../middleware/auth'

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'Messenger operation failed'
}

export function createMessengerRoutes(manager: MessengerManager): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    app.get('/messengers/connections', async (c) => {
        const connections = await manager.getConnections(c.get('namespace'))
        return c.json({ connections })
    })

    app.post('/messengers/telegram/configure', async (c) => {
        const parsed = ConfigureTelegramRequestSchema.safeParse(await c.req.json().catch(() => null))
        if (!parsed.success) return c.json({ error: 'Invalid Telegram configuration' }, 400)
        try {
            const connection = await manager.configureTelegram(c.get('namespace'), parsed.data)
            return c.json({ connection })
        } catch (error) {
            return c.json({ error: errorMessage(error) }, 502)
        }
    })

    app.post('/messengers/:provider/auth', async (c) => {
        const parsed = SubmitMessengerAuthRequestSchema.safeParse(await c.req.json().catch(() => null))
        if (!parsed.success) return c.json({ error: 'Invalid authentication response' }, 400)
        try {
            const connection = await manager.submitAuth(c.get('namespace'), c.req.param('provider'), parsed.data)
            return c.json({ connection })
        } catch (error) {
            return c.json({ error: errorMessage(error) }, 502)
        }
    })

    app.get('/messengers/:provider/candidates', async (c) => {
        try {
            const conversations = await manager.listCandidates(c.get('namespace'), c.req.param('provider'))
            return c.json({ conversations })
        } catch (error) {
            return c.json({ error: errorMessage(error) }, 502)
        }
    })

    app.put('/messengers/:provider/selection', async (c) => {
        const parsed = SelectMessengerConversationsRequestSchema.safeParse(await c.req.json().catch(() => null))
        if (!parsed.success) return c.json({ error: 'Invalid conversation selection' }, 400)
        try {
            const conversations = await manager.selectConversations(
                c.get('namespace'),
                c.req.param('provider'),
                parsed.data.remoteIds
            )
            return c.json({ conversations })
        } catch (error) {
            return c.json({ error: errorMessage(error) }, 502)
        }
    })

    app.get('/conversations', (c) => {
        return c.json({ conversations: manager.listConversations(c.get('namespace')) })
    })

    app.get('/conversations/:id/messages', async (c) => {
        try {
            const messages = await manager.listMessages(c.get('namespace'), c.req.param('id'))
            return c.json({ messages })
        } catch (error) {
            const message = errorMessage(error)
            return c.json({ error: message }, message === 'Conversation not found' ? 404 : 502)
        }
    })

    app.post('/conversations/:id/messages', async (c) => {
        const parsed = SendExternalMessageRequestSchema.safeParse(await c.req.json().catch(() => null))
        if (!parsed.success) return c.json({ error: 'Invalid message' }, 400)
        try {
            await manager.sendText(
                c.get('namespace'),
                c.req.param('id'),
                parsed.data.text,
                parsed.data.clientId
            )
            return c.json({ ok: true })
        } catch (error) {
            const message = errorMessage(error)
            return c.json({ error: message }, message === 'Conversation not found' ? 404 : 502)
        }
    })

    return app
}
