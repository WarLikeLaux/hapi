import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ConfigureMaxRequestSchema, type ExternalConversation, type ExternalMessage, type MessengerConnection } from '@hapi/protocol'
import type { DownloadedExternalMedia, MessengerConnector, MessengerConnectorEvent, SendExternalMediaInput } from '../types'
import { MaxClient, id, object, objects, type MaxObject, type MaxPacket } from './client'
import { attachments, avatarUrl, contactName, mediaUrl, normalizeConversation, normalizeMessage, reactions } from './shapes'

const MAX_MEDIA_BYTES = 50 * 1024 * 1024

/** Validate each redirect as well as the first URL, and never forward the account token to a CDN. */
async function fetchMedia(url: string, init: RequestInit = {}): Promise<Response> {
    for (let redirects = 0; redirects < 4; redirects++) {
        const safe = mediaUrl(url)
        if (!safe) throw new Error('MAX returned an unsupported media host')
        let response: Response
        try {
            response = await fetch(safe, { ...init, redirect: 'manual', signal: AbortSignal.timeout(60_000) })
        } catch { throw new Error('MAX media transfer failed') }
        if ([301, 302, 303, 307, 308].includes(response.status) && init.method !== 'POST') {
            const location = response.headers.get('location')
            await response.body?.cancel()
            if (!location) throw new Error('MAX media redirect is missing')
            url = new URL(location, safe).href
            continue
        }
        if (!response.ok) {
            await response.body?.cancel()
            throw new Error(`MAX media transfer failed (HTTP ${response.status})`)
        }
        return response
    }
    throw new Error('MAX media redirected too many times')
}

async function readMedia(response: Response): Promise<Uint8Array> {
    if (Number(response.headers.get('content-length')) > MAX_MEDIA_BYTES) {
        await response.body?.cancel()
        throw new Error('MAX media exceeds 50 MB')
    }
    const reader = response.body?.getReader()
    if (!reader) throw new Error('MAX media is empty')
    const chunks: Uint8Array[] = []
    let size = 0
    try {
        while (true) {
            const { done, value } = await reader.read()
            if (done) break
            size += value.byteLength
            if (size > MAX_MEDIA_BYTES) throw new Error('MAX media exceeds 50 MB')
            chunks.push(value)
        }
    } finally { await reader.cancel().catch(() => {}) }
    if (!size) throw new Error('MAX media is empty')
    return new Uint8Array(Buffer.concat(chunks))
}

export class MaxConnector implements MessengerConnector {
    readonly provider = 'max'
    private connection: MessengerConnection = { provider: 'max', state: 'unconfigured', accountLabel: null, detail: null }
    private client: MaxClient | null = null
    private configuring = false
    private selfId = ''
    private readonly contacts = new Map<string, MaxObject>()
    private readonly chats = new Map<string, MaxObject>()
    private readonly messages = new Map<string, MaxObject>()

    constructor(private readonly options: { namespace: string; dataDir: string; onEvent: (event: MessengerConnectorEvent) => void }) {}

    getConnection(): MessengerConnection { return this.connection }

    async configure(config: unknown): Promise<void> {
        const credentials = ConfigureMaxRequestSchema.parse(config)
        if (this.configuring) throw new Error('MAX connection is already starting')
        this.configuring = true
        this.client?.stop()
        this.contacts.clear()
        this.chats.clear()
        this.messages.clear()
        this.selfId = ''
        this.setConnection({ state: 'starting', accountLabel: null, accountAvatarUrl: null, detail: null })
        const client = new MaxClient({
            credentials,
            onState: (state, detail) => {
                if (this.client === client) this.setConnection({ state, detail })
            },
            onReady: (snapshot) => {
                if (this.client !== client) return
                const contact = object(object(snapshot.profile).contact)
                this.selfId = id(contact.id)!
                this.rememberContacts([contact, ...objects(snapshot.contacts)])
                for (const chat of objects(snapshot.chats)) this.rememberChat(chat)
                this.setConnection({ state: 'ready', accountLabel: contactName(contact) ?? `MAX ${this.selfId}`,
                    accountAvatarUrl: avatarUrl(contact), detail: null })
            },
            onPush: packet => { if (this.client === client) this.onPush(packet) }
        })
        this.client = client
        try { await client.connect() }
        catch (error) {
            // Failed first-time configuration has not been saved. Leave retrying it to the caller.
            client.stop()
            this.setConnection({ state: 'error', detail: error instanceof Error ? error.message : 'MAX connection failed' })
            throw error
        } finally { this.configuring = false }
    }

    async submitAuth(): Promise<void> { throw new Error('Connect MAX using a token and device ID from web.max.ru') }

    async listConversations(): Promise<ExternalConversation[]> {
        const client = this.requireClient()
        let marker: unknown = 0
        const markers = new Set<string>()
        for (let page = 0; page < 100; page++) {
            const response = await client.request(53, { count: 100, marker })
            this.rememberContacts(objects(response.contacts))
            const chats = objects(response.chats)
            for (const chat of chats) this.rememberChat(chat)
            const next = response.marker
            if (!chats.length || next === null || next === undefined || next === 0 || markers.has(String(next))) break
            markers.add(String(next))
            marker = next
        }
        const peerIds = [...this.chats.values()].flatMap(chat => Object.keys(object(chat.participants)))
        await this.resolveContacts(peerIds)
        return [...this.chats.values()].flatMap(chat => {
            const normalized = normalizeConversation(chat, this.selfId, this.contacts)
            return normalized ? [normalized] : []
        })
    }

    async loadMessages(remoteId: string, limit = 100): Promise<ExternalMessage[]> {
        const response = await this.requireClient().request(49, {
            chatId: this.chatId(remoteId), from: Date.now(), backward: Math.min(Math.max(limit, 1), 100), forward: 0,
            getMessages: true, getChat: true
        })
        if (id(object(response.chat).id)) this.rememberChat(object(response.chat))
        const raw = objects(response.messages).filter(message => message.status !== 'REMOVED')
        await this.resolveContacts(raw.flatMap(message => id(message.sender) ? [id(message.sender)!] : []))
        return raw.flatMap(message => {
            const normalized = this.rememberMessage(remoteId, message)
            return normalized ? [normalized] : []
        }).sort((a, b) => a.createdAt - b.createdAt)
    }

    async markReadMessage(remoteId: string, message: ExternalMessage): Promise<void> {
        await this.requireClient().request(50, { type: 'READ_MESSAGE', chatId: this.chatId(remoteId),
            messageId: message.providerMessageId, mark: message.createdAt })
        this.options.onEvent({ type: 'inbox-read', provider: 'max', remoteId, unreadCount: 0 })
    }

    async sendText(remoteId: string, text: string, clientId?: string, replyToProviderMessageId?: string): Promise<void> {
        await this.send(remoteId, text, [], clientId, replyToProviderMessageId)
    }

    async setReactions(remoteId: string, providerMessageId: string, chosen: string[]): Promise<void> {
        if (chosen.some(reaction => !reaction.startsWith('emoji:'))) throw new Error('MAX supports emoji reactions')
        const payload = { chatId: this.chatId(remoteId), messageId: providerMessageId }
        // MAX keeps one reaction per account. The newest clicked emoji replaces the previous one.
        const latest = chosen.at(-1)?.slice(6)
        await this.requireClient().request(latest ? 178 : 179,
            latest ? { ...payload, reaction: { reactionType: 'EMOJI', id: latest } } : payload)
    }

    async sendMedia(remoteId: string, input: SendExternalMediaInput): Promise<void> {
        const client = this.requireClient()
        const bytes = await readFile(input.path)
        if (!bytes.length || bytes.length > MAX_MEDIA_BYTES) throw new Error('MAX media must be between 1 byte and 50 MB')
        let attach: MaxObject
        if (input.mimeType.startsWith('image/')) {
            const slot = await client.request(80, { count: 1, profile: false })
            const url = mediaUrl(slot.url)
            if (!url) throw new Error('MAX did not return a photo upload URL')
            const form = new FormData()
            form.append('file', new Blob([bytes], { type: input.mimeType }), input.fileName)
            const result = object(await (await fetchMedia(url, { method: 'POST', body: form })).json())
            // The upload ticket is opaque; the response keys contain the assigned photo IDs.
            const token = Object.values(object(result.photos)).map(photo => object(photo).token)
                .find(token => typeof token === 'string' && token.length > 0)
            if (typeof token !== 'string' || !token) throw new Error('MAX did not confirm the photo upload')
            attach = { _type: 'PHOTO', photoToken: token }
        } else {
            const slot = objects((await client.request(87, { count: 1, name: input.fileName, size: bytes.length,
                ext: input.fileName.split('.').at(-1) ?? 'bin' })).info)[0]
            const fileId = id(slot?.fileId)
            const url = mediaUrl(slot?.url)
            if (!slot || !fileId || !url || typeof slot.token !== 'string') throw new Error('MAX did not return a file upload slot')
            const waiting = client.waitForAttachment(fileId)
            try {
                const form = new FormData()
                form.append('file', new Blob([bytes], { type: input.mimeType }), input.fileName)
                const response = await fetchMedia(url, { method: 'POST', body: form })
                await response.body?.cancel()
                await waiting.ready
            } finally { waiting.cancel() }
            attach = { _type: 'FILE', fileId: slot.fileId, token: slot.token, name: input.fileName, size: bytes.length }
        }
        await this.send(remoteId, input.caption, [attach], input.clientId, input.replyToProviderMessageId)
    }

    async downloadMedia(remoteId: string, providerMessageId: string, mediaIndex: number): Promise<DownloadedExternalMedia> {
        const client = this.requireClient()
        let raw = this.messages.get(`${remoteId}:${providerMessageId}`)
        if (!raw) {
            const response = await client.request(71, { chatId: this.chatId(remoteId), messageIds: [providerMessageId] })
            raw = objects(response.messages).find(message => id(message.id) === providerMessageId)
            if (raw) this.rememberMessage(remoteId, raw)
        }
        const attach = raw ? attachments(raw)[mediaIndex] : undefined
        if (!attach) throw new Error('MAX attachment not found')
        let url = mediaUrl(attach.baseUrl) ?? mediaUrl(attach.url) ?? mediaUrl(attach.fileUrl)
        if (attach._type === 'FILE' && id(attach.fileId)) {
            const result = await client.request(88, { chatId: this.chatId(remoteId), messageId: providerMessageId, fileId: attach.fileId })
            url = mediaUrl(result.url) ?? url
        }
        if (attach._type === 'VIDEO' && id(attach.videoId)) {
            const result = await client.request(83, { chatId: this.chatId(remoteId), messageId: providerMessageId,
                videoId: attach.videoId, token: attach.token })
            url = ['MP4_720', 'MP4_480', 'MP4_360', 'MP4_240'].map(key => mediaUrl(result[key])).find(Boolean) ?? url
        }
        if (!url) throw new Error('MAX did not return a download URL for this attachment')
        const response = await fetchMedia(url)
        const mimeType = response.headers.get('content-type')?.split(';')[0] ?? 'application/octet-stream'
        const bytes = await readMedia(response)
        const dir = join(this.options.dataDir, 'media')
        await mkdir(dir, { recursive: true, mode: 0o700 })
        const path = join(dir, `${createHash('sha256').update(`${remoteId}:${providerMessageId}:${mediaIndex}`).digest('hex')}.bin`)
        await writeFile(path, bytes, { mode: 0o600 })
        return { path, mimeType, fileName: typeof attach.name === 'string' ? attach.name
            : typeof attach.fileName === 'string' ? attach.fileName : 'attachment', size: bytes.length }
    }

    async stop(): Promise<void> { this.client?.stop(); this.client = null }

    private async send(remoteId: string, text: string, attaches: MaxObject[], clientId?: string, replyTo?: string): Promise<void> {
        // Keep the provider cid stable across a retry after an uncertain acknowledgement.
        const cid = parseInt(createHash('sha256').update(clientId ?? randomUUID()).digest('hex').slice(0, 13), 16)
        const result = await this.requireClient().request(64, { chatId: this.chatId(remoteId), notify: true,
            message: { text, cid, elements: [], attaches, ...(replyTo ? { link: { type: 'REPLY', messageId: replyTo } } : {}) } })
        const message = this.rememberMessage(remoteId, object(result.message))
        if (!message) throw new Error('MAX did not confirm the sent message')
        this.options.onEvent({ type: 'message', message })
    }

    private requireClient(): MaxClient {
        if (!this.client || this.connection.state !== 'ready') throw new Error('MAX is not connected. Check the token and device ID in Chats settings.')
        return this.client
    }

    private chatId(remoteId: string): number {
        const value = Number(remoteId)
        if (!/^-?\d+$/.test(remoteId) || !Number.isSafeInteger(value)) throw new Error('Invalid MAX chat ID')
        return value
    }

    private rememberContacts(contacts: MaxObject[]): void {
        for (const contact of contacts) {
            const contactId = id(contact.id)
            if (contactId) this.contacts.set(contactId, contact)
        }
    }

    private async resolveContacts(ids: string[]): Promise<void> {
        const missing = [...new Set(ids)].filter(value => !this.contacts.has(value) && Number.isSafeInteger(Number(value)))
        for (let offset = 0; offset < missing.length; offset += 100) {
            try {
                this.rememberContacts(objects((await this.requireClient().request(32, {
                    contactIds: missing.slice(offset, offset + 100).map(Number)
                })).contacts))
            } catch { break } // Missing names must not prevent reading messages.
        }
    }

    private rememberChat(raw: MaxObject): void {
        const remoteId = id(raw.id)
        if (!remoteId) return
        const merged = { ...this.chats.get(remoteId), ...raw }
        this.chats.set(remoteId, merged)
        const conversation = normalizeConversation(merged, this.selfId, this.contacts)
        if (conversation) this.options.onEvent({ type: 'conversation', conversation })
    }

    private rememberMessage(remoteId: string, raw: MaxObject): ExternalMessage | null {
        const normalized = normalizeMessage(remoteId, raw, this.selfId, this.contacts)
        if (normalized) {
            this.messages.set(`${remoteId}:${normalized.providerMessageId}`, raw)
            if (this.messages.size > 2_000) this.messages.delete(this.messages.keys().next().value!)
        }
        return normalized
    }

    private onPush(packet: MaxPacket): void {
        const payload = packet.payload
        const remoteId = id(payload.chatId)
        if (packet.opcode === 128 && remoteId) {
            const raw = object(payload.message)
            const messageId = id(raw.id)
            if ((raw.status === 'REMOVED' || raw.deleted === true) && messageId) {
                this.messages.delete(`${remoteId}:${messageId}`)
                this.options.onEvent({ type: 'messages-deleted', provider: 'max', remoteId, providerMessageIds: [messageId] })
                return
            }
            const message = this.rememberMessage(remoteId, raw)
            if (message) this.options.onEvent({ type: 'message', message })
            const chat = this.chats.get(remoteId)
            if (chat && raw.status !== 'EDITED') this.rememberChat({ ...chat, lastMessage: raw,
                ...(typeof payload.unread === 'number' ? { newMessages: payload.unread } : {}) })
        } else if ([155, 156].includes(packet.opcode) && remoteId && id(payload.messageId)) {
            this.options.onEvent({ type: 'message-reactions', provider: 'max', remoteId,
                providerMessageId: id(payload.messageId)!, reactions: reactions(payload.reactionInfo) })
        } else if (packet.opcode === 129 && id(object(payload.chat).id)) {
            this.rememberChat(object(payload.chat))
        }
    }

    private setConnection(update: Partial<MessengerConnection>): void {
        this.connection = { ...this.connection, ...update }
        this.options.onEvent({ type: 'connection', connection: this.connection })
    }
}
