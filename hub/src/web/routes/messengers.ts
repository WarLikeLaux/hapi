import {
    ConfigureTelegramRequestSchema,
    SelectMessengerConversationsRequestSchema,
    SendExternalMessageRequestSchema,
    SubmitMessengerAuthRequestSchema
} from '@hapi/protocol'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import type { MessengerManager } from '../../messengers/manager'
import type { WebAppEnv } from '../middleware/auth'

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'Messenger operation failed'
}

const MAX_MESSENGER_MEDIA_BYTES = 50 * 1024 * 1024

function inlineContentDisposition(fileName: string): string {
    const sanitized = fileName.replace(/[\r\n\0"\\]/g, '_')
    const asciiFallback = sanitized.replace(/[^\x20-\x7E]/g, '_')
    const encoded = encodeURIComponent(sanitized).replace(/['()*]/g, (character) =>
        `%${character.charCodeAt(0).toString(16).toUpperCase()}`
    )
    return `inline; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`
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

    app.get('/conversations', async (c) => {
        const namespace = c.get('namespace')
        // This endpoint is also queried by the global Agents/Chats navigation.
        // Starting configured connectors here keeps incoming messages live even
        // when the user has not opened the Chats route since the hub restarted.
        await manager.getConnections(namespace)
        return c.json({ conversations: manager.listConversations(namespace) })
    })

    app.get('/conversations/:id/messages', async (c) => {
        try {
            const namespace = c.get('namespace')
            const conversationId = c.req.param('id')
            const messages = await manager.listMessages(namespace, conversationId)
            const participants = manager.listParticipants(namespace, conversationId)
            return c.json({ messages, participants })
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

    app.get('/conversations/:id/messages/:messageId/media/:mediaIndex', async (c) => {
        const mediaIndex = Number(c.req.param('mediaIndex'))
        if (!Number.isInteger(mediaIndex) || mediaIndex < 0) return c.json({ error: 'Invalid media index' }, 400)
        try {
            const media = await manager.downloadMedia(
                c.get('namespace'),
                c.req.param('id'),
                c.req.param('messageId'),
                mediaIndex
            )
            return new Response(Bun.file(media.path), {
                headers: {
                    'content-type': media.mimeType || 'application/octet-stream',
                    'content-length': String(media.size),
                    'content-disposition': inlineContentDisposition(media.fileName),
                    'cache-control': 'private, max-age=86400'
                }
            })
        } catch (error) {
            const message = errorMessage(error)
            return c.json({ error: message }, message.includes('not found') ? 404 : 502)
        }
    })

    app.post('/conversations/:id/media', bodyLimit({
        maxSize: MAX_MESSENGER_MEDIA_BYTES + 1024 * 1024,
        onError: (c) => c.json({ error: 'Media file is too large' }, 413)
    }), async (c) => {
        const form = await c.req.formData().catch(() => null)
        const file = form?.get('file')
        const captionValue = form?.get('caption')
        const clientIdValue = form?.get('clientId')
        if (!(file instanceof File) || file.size < 1 || file.size > MAX_MESSENGER_MEDIA_BYTES) {
            return c.json({ error: 'Media file must be between 1 byte and 50 MB' }, 400)
        }
        const caption = typeof captionValue === 'string' ? captionValue.trim() : ''
        if (caption.length > 4096) return c.json({ error: 'Caption is too long' }, 400)
        const clientId = typeof clientIdValue === 'string' && clientIdValue.length <= 128 ? clientIdValue : undefined
        try {
            await manager.sendMedia(c.get('namespace'), c.req.param('id'), {
                bytes: new Uint8Array(await file.arrayBuffer()),
                fileName: file.name || 'attachment',
                mimeType: file.type || 'application/octet-stream',
                caption,
                clientId
            })
            return c.json({ ok: true })
        } catch (error) {
            const message = errorMessage(error)
            return c.json({ error: message }, message === 'Conversation not found' ? 404 : 502)
        }
    })

    return app
}
