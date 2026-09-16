import { existsSync, statSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import type {
    ConfigureTelegramRequest,
    ExternalConversation,
    ExternalMessage,
    MessengerConnection,
    SubmitMessengerAuthRequest
} from '@hapi/protocol'
import type { DownloadedExternalMedia, MessengerConnector, MessengerConnectorEvent, SendExternalMediaInput } from './types'

type RpcResponse = { id: string; result?: unknown; error?: string }
type SidecarEvent = { event: string; data?: unknown }

function connectorCommand(): { cmd: string[]; cwd?: string } | null {
    const configured = process.env.HAPI_TELEGRAM_CONNECTOR_BIN?.trim()
    if (configured) return { cmd: [configured] }

    const siblingBinary = join(dirname(process.execPath), process.platform === 'win32'
        ? 'hapi-telegram-connector.exe'
        : 'hapi-telegram-connector')
    if (existsSync(siblingBinary)) return { cmd: [siblingBinary] }

    const roots = [
        process.cwd(),
        resolve(import.meta.dir, '..', '..', '..')
    ]
    for (const root of roots) {
        const binary = join(root, 'connectors', 'telegram', 'hapi-telegram-connector')
        if (existsSync(binary)) return { cmd: [binary] }
        const source = join(root, 'connectors', 'telegram', 'go.mod')
        if (existsSync(source)) return { cmd: ['go', 'run', '.'], cwd: join(root, 'connectors', 'telegram') }
    }
    return null
}

export class TelegramConnector implements MessengerConnector {
    readonly provider = 'telegram'
    private connection: MessengerConnection = {
        provider: 'telegram',
        state: 'unconfigured',
        accountLabel: null,
        detail: null
    }
    private process: ReturnType<typeof Bun.spawn> | null = null
    private nextId = 1
    private readonly pending = new Map<string, {
        resolve: (value: unknown) => void
        reject: (error: Error) => void
        timer: ReturnType<typeof setTimeout>
    }>()

    constructor(private readonly options: {
        namespace: string
        dataDir: string
        onEvent: (event: MessengerConnectorEvent) => void
    }) {}

    getConnection(): MessengerConnection {
        return this.connection
    }

    async configure(config: unknown): Promise<void> {
        const typed = config as ConfigureTelegramRequest
        await this.ensureProcess()
        this.setConnection({ state: 'starting', detail: null })
        await this.request('configure', {
            apiId: typed.apiId,
            apiHash: typed.apiHash,
            sessionPath: join(this.options.dataDir, 'session.json')
        }, 60_000)
    }

    async submitAuth(input: SubmitMessengerAuthRequest): Promise<void> {
        await this.ensureProcess()
        await this.request('auth.submit', input)
    }

    async listConversations(): Promise<ExternalConversation[]> {
        const result = await this.request('conversations.list', {})
        return (result as { conversations: ExternalConversation[] }).conversations
    }

    async loadMessages(remoteId: string, limit = 100): Promise<ExternalMessage[]> {
        const result = await this.request('messages.load', { remoteId, limit })
        return (result as { messages: ExternalMessage[] }).messages
    }

    async downloadMedia(remoteId: string, providerMessageId: string, mediaIndex: number): Promise<DownloadedExternalMedia> {
        const result = await this.request('media.download', { remoteId, providerMessageId, mediaIndex }, 180_000) as DownloadedExternalMedia
        const mediaRoot = resolve(this.options.dataDir, 'media-cache')
        const mediaPath = resolve(result.path)
        if (!mediaPath.startsWith(`${mediaRoot}${sep}`) || !statSync(mediaPath).isFile()) {
            throw new Error('Telegram connector returned an invalid media path')
        }
        return { ...result, path: mediaPath }
    }

    async sendText(remoteId: string, text: string, clientId?: string): Promise<void> {
        await this.request('messages.send', { remoteId, text, clientId })
    }

    async sendMedia(remoteId: string, input: SendExternalMediaInput): Promise<void> {
        await this.request('media.send', { remoteId, ...input }, 180_000)
    }

    async stop(): Promise<void> {
        const child = this.process
        this.process = null
        if (!child) return
        try {
            child.kill()
            await child.exited
        } catch {
        }
    }

    private setConnection(patch: Partial<MessengerConnection>): void {
        this.connection = { ...this.connection, ...patch }
        this.options.onEvent({ type: 'connection', connection: this.connection })
    }

    private async ensureProcess(): Promise<void> {
        if (this.process) return
        const launch = connectorCommand()
        if (!launch) {
            this.setConnection({
                state: 'unavailable',
                detail: 'Telegram connector not found. Build connectors/telegram or set HAPI_TELEGRAM_CONNECTOR_BIN.'
            })
            throw new Error(this.connection.detail ?? 'Telegram connector unavailable')
        }

        const child = Bun.spawn(launch.cmd, {
            cwd: launch.cwd,
            stdin: 'pipe',
            stdout: 'pipe',
            stderr: 'pipe',
            env: { ...process.env }
        })
        this.process = child
        void this.readStdout(child.stdout)
        void this.readStderr(child.stderr)
        void child.exited.then((code) => {
            if (this.process !== child) return
            this.process = null
            const error = new Error(`Telegram connector stopped with exit code ${code}`)
            for (const item of this.pending.values()) {
                clearTimeout(item.timer)
                item.reject(error)
            }
            this.pending.clear()
            this.setConnection({ state: 'error', detail: error.message })
        })
    }

    private async readStdout(stream: ReadableStream<Uint8Array>): Promise<void> {
        const decoder = new TextDecoder()
        let buffer = ''
        for await (const chunk of stream) {
            buffer += decoder.decode(chunk, { stream: true })
            let newline = buffer.indexOf('\n')
            while (newline >= 0) {
                const line = buffer.slice(0, newline).trim()
                buffer = buffer.slice(newline + 1)
                if (line) this.handleLine(line)
                newline = buffer.indexOf('\n')
            }
        }
    }

    private async readStderr(stream: ReadableStream<Uint8Array>): Promise<void> {
        const decoder = new TextDecoder()
        for await (const chunk of stream) {
            const line = decoder.decode(chunk).trim()
            if (line) console.error(`[Telegram connector] ${line}`)
        }
    }

    private handleLine(line: string): void {
        let value: RpcResponse | SidecarEvent
        try {
            value = JSON.parse(line) as RpcResponse | SidecarEvent
        } catch {
            console.error('[Telegram connector] Invalid JSON output')
            return
        }
        if ('id' in value) {
            const pending = this.pending.get(value.id)
            if (!pending) return
            this.pending.delete(value.id)
            clearTimeout(pending.timer)
            if (value.error) pending.reject(new Error(value.error))
            else pending.resolve(value.result)
            return
        }
        this.handleEvent(value)
    }

    private handleEvent(value: SidecarEvent): void {
        if (value.event === 'connection') {
            const connection = value.data as Omit<MessengerConnection, 'provider'>
            this.connection = { provider: 'telegram', ...connection }
            this.options.onEvent({ type: 'connection', connection: this.connection })
        } else if (value.event === 'conversation') {
            this.options.onEvent({ type: 'conversation', conversation: value.data as ExternalConversation })
        } else if (value.event === 'message') {
            this.options.onEvent({ type: 'message', message: value.data as ExternalMessage })
        } else if (value.event === 'messages-deleted') {
            const deleted = value.data as { remoteId?: string; providerMessageIds: string[] }
            this.options.onEvent({
                type: 'messages-deleted',
                provider: 'telegram',
                remoteId: deleted.remoteId,
                providerMessageIds: deleted.providerMessageIds
            })
        } else if (value.event === 'messages-read') {
            const receipt = value.data as { remoteId: string; maxId: number }
            this.options.onEvent({
                type: 'messages-read',
                provider: 'telegram',
                remoteId: receipt.remoteId,
                maxProviderMessageId: receipt.maxId
            })
        }
    }

    private async request(method: string, params: unknown, timeoutMs = 30_000): Promise<unknown> {
        await this.ensureProcess()
        const child = this.process
        if (!child?.stdin || typeof child.stdin === 'number') throw new Error('Telegram connector is not running')
        const id = `${this.nextId++}`
        const promise = new Promise<unknown>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id)
                reject(new Error(`Telegram connector timed out: ${method}`))
            }, timeoutMs)
            this.pending.set(id, { resolve, reject, timer })
        })
        child.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
        child.stdin.flush()
        return await promise
    }
}
