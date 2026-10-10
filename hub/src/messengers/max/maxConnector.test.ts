import { afterEach, describe, expect, it, mock } from 'bun:test'
import type { ServerWebSocket } from 'bun'
import { Hono } from 'hono'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MessengerManager } from '../manager'
import { Store } from '../../store'
import type { SSEManager } from '../../sse/sseManager'
import { createMessengerRoutes } from '../../web/routes/messengers'
import type { WebAppEnv } from '../../web/middleware/auth'
import { MaxConnector } from './maxConnector'
import type { MessengerConnectorEvent } from '../types'

const NativeWebSocket = globalThis.WebSocket
const nativeFetch = globalThis.fetch
afterEach(() => { globalThis.WebSocket = NativeWebSocket; globalThis.fetch = nativeFetch })

const credentials = { token: 'private-test-token', deviceId: 'aab00f80-00dd-4c76-9d77-aa1133007722' }
const messageId = '116762203424780659'
const sentMessageId = '116762203424780661'
const history = [{ id: messageId, sender: 8, text: 'Before', time: 1_790_000_000_000, attaches: [] }]

function serveMax() {
    const packets: { opcode: number; payload: Record<string, unknown> }[] = []
    const sockets = new Set<ServerWebSocket<undefined>>()
    const messages: Record<string, unknown>[] = [...history]
    const uploaded: { name: string; bytes: Uint8Array }[] = []
    const chats = [{ id: 42, type: 'DIALOG', participants: { '7': 0, '8': 0 },
        lastMessage: history[0], newMessages: 1 }, { id: 0, type: 'DIALOG', participants: { '7': 0 } }]
    const server = Bun.serve({
        hostname: '127.0.0.1', port: 0,
        fetch: async (req, server) => {
            const path = new URL(req.url).pathname
            if (path === '/download') return new Response('file-content', { headers: { 'content-type': 'text/plain' } })
            if (path === '/animation') return new Response('animated-video', { headers: { 'content-type': 'video/mp4' } })
            if (path === '/lottie') return new Response('{"v":"5.7.4"}', { headers: { 'content-type': 'application/json' } })
            if (path === '/unsafe-redirect') return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/private' } })
            if (path.startsWith('/upload')) {
                const file = (await req.formData()).get('file') as File
                uploaded.push({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) })
                if (path === '/upload-file') {
                    // Processing completes before the HTTP response: the client must already be waiting.
                    for (const socket of sockets) socket.send(JSON.stringify({ cmd: 0, seq: 0, opcode: 136, payload: { fileId: 123 } }))
                }
                return Response.json(path === '/upload-photo' ? { photos: { '123': { token: 'uploaded-photo' } } } : {})
            }
            return server.upgrade(req) ? undefined : new Response('Not found', { status: 404 })
        },
        websocket: {
            open: (socket: ServerWebSocket<undefined>) => { sockets.add(socket) },
            close: (socket: ServerWebSocket<undefined>) => { sockets.delete(socket) },
            message: (socket: ServerWebSocket<undefined>, bytes: string | Buffer) => {
                const packet = JSON.parse(String(bytes))
                packets.push(packet)
                const payload = packet.payload
                const reply = (body: unknown, cmd = 1) => {
                    // A real MAX response can carry an unquoted 64-bit message id.
                    const raw = JSON.stringify({ ...packet, cmd, payload: body })
                        .replaceAll(`"${messageId}"`, messageId)
                    socket.send(raw)
                }
                if (packet.opcode === 6) reply({})
                else if (packet.opcode === 19) {
                    if (payload.token !== credentials.token) reply({ error: `auth failed: ${payload.token}` }, 3)
                    else reply({ profile: { contact: { id: 7, names: [{ name: 'Owner' }], baseUrl: 'https://i.oneme.ru/owner' } }, chats, contacts: [] })
                } else if (packet.opcode === 53) reply({ chats, marker: null })
                else if (packet.opcode === 32) reply({ contacts: [{ id: 8, names: [{ firstName: 'Peer', lastName: 'Name' }], baseUrl: 'https://i.oneme.ru/peer' }] })
                else if (packet.opcode === 80) reply({ url: 'https://iu.oneme.ru/upload-photo?r=opaque-upload-ticket' })
                else if (packet.opcode === 87) reply({ info: [{ fileId: 123, url: 'https://file-ms.oneme.ru/upload-file', token: 'file-token' }] })
                else if (packet.opcode === 49) reply({ messages })
                else if (packet.opcode === 64) {
                    let message = messages.find(message => message.cid === payload.message.cid)
                    if (!message) {
                        const created: Record<string, unknown> = { ...payload.message, id: sentMessageId, sender: 7, time: 1_790_000_000_001 }
                        messages.push(created)
                        message = created
                    }
                    reply({ message })
                }
                else reply({})
            }
        }
    })
    globalThis.WebSocket = mock(function (url: string, options: unknown) {
        expect(url).toBe('wss://ws-api.oneme.ru/websocket')
        expect(options).toMatchObject({ headers: { Origin: 'https://web.max.ru' } })
        return Reflect.construct(NativeWebSocket, [`ws://127.0.0.1:${server.port}`, options])
    }) as unknown as typeof WebSocket
    Object.setPrototypeOf(globalThis.WebSocket, NativeWebSocket)
    return { server, sockets, packets, uploaded }
}

async function eventually(check: () => void): Promise<void> {
    for (let attempt = 0; attempt < 150; attempt++) {
        try { check(); return } catch (error) {
            if (attempt === 149) throw error
            await Bun.sleep(20)
        }
    }
}

describe('MAX personal-account connector', () => {
    it('connects through authenticated REST, isolates credentials, preserves large ids, and delivers reads, replies and live updates', async () => {
        const { server, sockets, packets } = serveMax()
        const dataDir = await mkdtemp(join(tmpdir(), 'hapi-max-'))
        const store = new Store(':memory:')
        const broadcasts: unknown[] = []
        const manager = new MessengerManager({ dataDir, store,
            sseManager: { broadcast: (event: unknown) => broadcasts.push(event) } as unknown as SSEManager })
        const app = new Hono<WebAppEnv>()
        app.use('*', async (c, next) => { c.set('namespace', c.req.header('test-namespace') ?? 'owner'); await next() })
        app.route('/', createMessengerRoutes(manager))
        const post = (path: string, body: unknown, method = 'POST') => app.request(path, {
            method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
        })
        const configDir = join(dataDir, 'messengers', createHash('sha256').update('owner').digest('hex').slice(0, 24), 'max')
        try {
            expect((await post('/messengers/max/configure', { ...credentials, deviceId: 'invalid' })).status).toBe(400)
            expect(packets).toHaveLength(0)
            const rejected = await post('/messengers/max/configure', { ...credentials, token: 'secret-rejected-token' })
            expect(rejected.status).toBe(502)
            expect(await rejected.text()).not.toContain('secret-rejected-token')
            expect(await readdir(configDir)).not.toContain('config.json')
            const configured = await post('/messengers/max/configure', credentials)
            expect(configured.status).toBe(200)
            expect(await configured.json()).toEqual({ connection: {
                provider: 'max', state: 'ready', accountLabel: 'Owner', detail: null, accountAvatarUrl: 'https://i.oneme.ru/owner'
            } })
            expect((await stat(configDir)).mode & 0o777).toBe(0o700)
            expect((await stat(join(configDir, 'config.json'))).mode & 0o777).toBe(0o600)
            expect(JSON.parse(await readFile(join(configDir, 'config.json'), 'utf8'))).toEqual(credentials)
            expect(JSON.stringify(await (await app.request('/messengers/connections', {
                headers: { 'test-namespace': 'someone-else' }
            })).json())).not.toContain('Owner')
            const candidates = await (await app.request('/messengers/max/candidates?refresh=true')).json() as {
                conversations: { id: string; title: string; kind: string }[]
            }
            expect(candidates.conversations[0]).toMatchObject({ id: 'max:42', title: 'Peer Name', kind: 'direct', avatarDataUrl: 'https://i.oneme.ru/peer' })
            expect(candidates.conversations[1]).toMatchObject({ id: 'max:0', title: 'Saved messages', kind: 'saved', avatarDataUrl: 'https://i.oneme.ru/owner' })
            expect((await post('/messengers/max/selection', { remoteIds: ['42'] }, 'PUT')).status).toBe(200)
            await eventually(() => expect(store.messengers.listMessages('owner', 'max:42')[0])
                .toMatchObject({ providerMessageId: messageId, text: 'Before', senderName: 'Peer Name' }))
            expect(await (await app.request('/conversations/max:42/participants')).json())
                .toMatchObject({ participants: [{ id: '8', avatarDataUrl: 'https://i.oneme.ru/peer' }] })
            await app.request('/conversations/max:42/messages')
            expect(packets.filter(packet => packet.opcode === 50).at(-1)?.payload)
                .toEqual({ type: 'READ_MESSAGE', chatId: 42, messageId, mark: history[0].time })
            for (let attempt = 0; attempt < 2; attempt++) {
                expect((await post('/conversations/max:42/messages', {
                    text: 'Reply', clientId: 'stable-retry-id', replyToProviderMessageId: messageId
                })).status).toBe(200)
            }
            const sends = packets.filter(packet => packet.opcode === 64)
            expect(sends[0].payload).toMatchObject({ chatId: 42,
                message: { text: 'Reply', link: { type: 'REPLY', messageId } } })
            expect(sends[0].payload.message).toEqual(sends[1].payload.message)
            expect(store.messengers.listMessages('owner', 'max:42').find(message => message.providerMessageId === sentMessageId))
                .toMatchObject({ text: 'Reply', direction: 'outgoing', replyToProviderMessageId: messageId })
            for (const socket of sockets) socket.send(JSON.stringify({ cmd: 0, opcode: 128, seq: 90, payload: {
                chatId: 42, message: { id: '116762203424780660', sender: 8, text: 'Live', time: 1_790_000_000_002 }
            } }))
            await eventually(() => expect(store.messengers.listMessages('owner', 'max:42').map(message => message.text)).toContain('Live'))
            for (const socket of sockets) socket.send(JSON.stringify({ cmd: 0, opcode: 156, seq: 91, payload: {
                chatId: 42, messageId, reactionInfo: { counters: [{ reaction: '👍', count: 2 }], yourReaction: '👍' }
            } }))
            await eventually(() => expect(store.messengers.listMessages('owner', 'max:42')[0].reactions)
                .toEqual([{ reaction: 'emoji:👍', emoji: '👍', count: 2, chosen: true }]))
            expect((await post(`/conversations/max:42/messages/${messageId}/reactions`, { reactions: ['emoji:❤️'] }, 'PUT')).status).toBe(200)
            expect(packets.find(packet => packet.opcode === 178)?.payload).toMatchObject({ messageId,
                reaction: { reactionType: 'EMOJI', id: '❤️' } })
            expect(broadcasts).toContainEqual({ type: 'external-message-received', namespace: 'owner', conversationId: 'max:42' })
            // Hub restart resumes from the same namespace's persisted credentials.
            await manager.stop()
            const restarted = new MessengerManager({ dataDir, store,
                sseManager: { broadcast: () => {} } as unknown as SSEManager })
            try { expect((await restarted.getConnections('owner')).find(connection => connection.provider === 'max')?.state).toBe('ready') }
            finally {
                await eventually(() => expect(packets.filter(packet => packet.opcode === 49).length).toBeGreaterThan(2))
                await Bun.sleep(20)
                await restarted.stop()
            }
        } finally {
            await manager.stop()
            server.stop(true)
            store.close()
            await rm(dataDir, { recursive: true, force: true })
        }
    })

    it('reauthenticates after socket loss and stops reconnecting when disposed', async () => {
        const { server, sockets, packets } = serveMax()
        const events: MessengerConnectorEvent[] = []
        const connector = new MaxConnector({ namespace: 'owner', dataDir: tmpdir(), onEvent: event => events.push(event) })
        try {
            await connector.configure(credentials)
            for (const socket of sockets) socket.close()
            await eventually(() => expect(connector.getConnection().state).toBe('starting'))
            await eventually(() => expect(packets.filter(packet => packet.opcode === 19)).toHaveLength(2))
            await eventually(() => expect(connector.getConnection().state).toBe('ready'))
            await connector.stop()
            const count = packets.length
            await Bun.sleep(1_100)
            expect(packets).toHaveLength(count)
            expect(sockets.size).toBe(0)
        } finally { await connector.stop(); server.stop(true) }
    })

    it('rejects media outside MAX CDNs without fetching it', async () => {
        const { server, sockets } = serveMax()
        const connector = new MaxConnector({ namespace: 'owner', dataDir: tmpdir(), onEvent: () => {} })
        try {
            await connector.configure(credentials)
            for (const socket of sockets) socket.send(JSON.stringify({ cmd: 0, opcode: 128, seq: 1, payload: {
                chatId: 42, message: { id: '55', sender: 8, text: '', time: Date.now(),
                    attaches: [{ _type: 'PHOTO', baseUrl: 'http://127.0.0.1/private' }] }
            } }))
            await Bun.sleep(30)
            await expect(connector.downloadMedia('42', '55', 0)).rejects.toThrow('MAX did not return a download URL')
        } finally { await connector.stop(); server.stop(true) }
    })

    it('uploads photos, GIFs and processed files, downloads private media, and validates redirect destinations', async () => {
        const { server, sockets, packets, uploaded } = serveMax()
        const dataDir = await mkdtemp(join(tmpdir(), 'hapi-max-media-'))
        const events: MessengerConnectorEvent[] = []
        const connector = new MaxConnector({ namespace: 'owner', dataDir, onEvent: event => events.push(event) })
        // Redirect the real HTTP requests to our server after the production host check.
        globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
            const url = new URL(input instanceof Request ? input.url : input)
            expect(url.protocol).toBe('https:')
            expect(['iu.oneme.ru', 'file-ms.oneme.ru']).toContain(url.hostname)
            return nativeFetch(`http://127.0.0.1:${server.port}${url.pathname}${url.search}`, init)
        }) as typeof fetch
        try {
            await connector.configure(credentials)
            const path = join(dataDir, 'outgoing')
            await writeFile(path, 'upload-bytes')
            for (const mimeType of ['image/png', 'text/plain']) await connector.sendMedia('42', {
                path, mimeType, fileName: 'test.bin', caption: 'Caption', clientId: mimeType
            })
            const gif = Buffer.from(
                '47494638396101000100800000000000ffffff21ff0b4e45545343415045322e300301000000'
                + '21f904000a0000002c0000000001000100000202440100'
                + '21f904000a0000002c00000000010001000002024c01003b', 'hex'
            )
            await writeFile(path, gif)
            await connector.sendMedia('42', {
                path, mimeType: 'image/gif', fileName: 'animation.gif', caption: 'GIF caption',
                clientId: 'gif-send', replyToProviderMessageId: messageId
            })
            expect(uploaded.slice(0, 2).map(file => Buffer.from(file.bytes).toString())).toEqual(['upload-bytes', 'upload-bytes'])
            expect(uploaded[2].name).toBe('animation.gif')
            expect(Buffer.from(uploaded[2].bytes)).toEqual(gif)
            const sends = packets.filter(packet => packet.opcode === 64)
            expect(sends[0].payload).toMatchObject({ message: { attaches: [{ _type: 'PHOTO', photoToken: 'uploaded-photo' }] } })
            expect(sends[1].payload).toMatchObject({ message: { attaches: [{ _type: 'FILE', fileId: 123, token: 'file-token' }] } })
            expect(sends[2].payload).toMatchObject({ message: {
                text: 'GIF caption', attaches: [{ _type: 'PHOTO', photoToken: 'uploaded-photo' }],
                link: { type: 'REPLY', messageId }
            } })
            for (const socket of sockets) socket.send(JSON.stringify({ cmd: 0, opcode: 128, seq: 2, payload: {
                chatId: 42, message: { id: '66', sender: 8, text: '', time: Date.now(), attaches: [
                    { _type: 'INLINE_KEYBOARD', keyboard: { buttons: [[{ text: 'Open', url: 'https://example.com' }]] } },
                    { _type: 'PHOTO', baseUrl: 'https://iu.oneme.ru/download' },
                    { _type: 'PHOTO', baseUrl: 'https://iu.oneme.ru/unsafe-redirect' },
                    { _type: 'PHOTO', baseUrl: 'https://iu.oneme.ru/static', mp4Url: 'https://iu.oneme.ru/animation' },
                    { _type: 'STICKER', url: 'https://iu.oneme.ru/static', mp4Url: 'https://iu.oneme.ru/animation', lottieUrl: 'https://iu.oneme.ru/lottie' },
                    { _type: 'STICKER', url: 'https://iu.oneme.ru/static', lottieUrl: 'https://iu.oneme.ru/lottie' }
                ] }
            } }))
            await eventually(() => expect(events.some(event => event.type === 'message' && event.message.providerMessageId === '66')).toBe(true))
            expect(events.find(event => event.type === 'message' && event.message.providerMessageId === '66'))
                .toMatchObject({ message: { media: [
                    { kind: 'image' }, { kind: 'image' },
                    { kind: 'video', mimeType: 'video/mp4', isAnimated: true },
                    { kind: 'sticker', mimeType: 'video/mp4', isAnimated: true },
                    { kind: 'sticker', mimeType: 'application/json', isAnimated: true }
                ] } })
            const download = await connector.downloadMedia('42', '66', 0)
            expect(await readFile(download.path, 'utf8')).toBe('file-content')
            expect(download.mimeType).toBe('text/plain')
            expect((await stat(download.path)).mode & 0o777).toBe(0o600)
            await expect(connector.downloadMedia('42', '66', 1)).rejects.toThrow('MAX returned an unsupported media host')
            for (const index of [2, 3]) {
                const animation = await connector.downloadMedia('42', '66', index)
                expect(animation.mimeType).toBe('video/mp4')
                expect(await readFile(animation.path, 'utf8')).toBe('animated-video')
            }
            const lottie = await connector.downloadMedia('42', '66', 4)
            expect(lottie.mimeType).toBe('application/json')
            expect(await readFile(lottie.path, 'utf8')).toBe('{"v":"5.7.4"}')
        } finally { await connector.stop(); server.stop(true); await rm(dataDir, { recursive: true, force: true }) }
    })
})
