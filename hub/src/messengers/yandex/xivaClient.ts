/**
 * Xiva WebSocket transport for the personal Yandex Messenger protocol.
 *
 * Every protocol operation — reading `history` and mutating through `push` — rides a
 * single xiva subscription socket. Handshake is cookie-only:
 *
 *   wss://push.yandex.ru/v2/subscribe/websocket
 *     ?service=messenger-prod:version5*common+version5*main&session=<4x4hex>&client=web_main&user=<uid>
 *
 * No `sign`/`ts` on this path: the handshake headers authorize. Per-connection state
 * resets on every reconnect: `seq` starts at 1 and `subscription-id` arrives in the
 * operational text frame `subscribed` (a reconnect mints a NEW id, never reuse).
 */
import { randomBytes, randomUUID } from 'node:crypto'
import { decodeFrame, encodeDataFrame, FrameType, type RawFrame } from './frameCodec'

/** Transport-layer error codes carried by PROXY_STATUS frames. */
const TRANSPORT_ERROR_NAMES: Record<number, string> = {
    0: 'SUCCESS',
    1: 'PROTOCOL_ERROR',
    2: 'BACKEND_CALL_ERROR',
    3: 'INTERNAL_ERROR',
    4: 'CORRUPTED_DATA_HEADER',
    5: 'BACKEND_NOT_FOUND',
    6: 'SERVICE_UNAVAILABLE',
    7: 'TOO_MANY_REQUESTS',
    8: 'FRAME_TOO_LARGE'
}

/** Close reasons that mean the session cookies died; the client stops instead of retrying. */
const AUTH_CLOSE_REASONS = ['cookie auth failed', 'no credentials', 'bad sign']

export const PUSH_METHOD = 'push'
const PING_TIMEOUT_FACTOR = 1.3
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000
const SUBSCRIBED_TIMEOUT_MS = 15_000
const RECONNECT_BASE_MS = 1_000
const RECONNECT_MAX_MS = 30_000

/** Minimal socket surface used here; satisfied by Bun's native WebSocket. */
interface WebSocketLike {
    send(data: string | Uint8Array): void
    close(code?: number, reason?: string): void
    onopen: (() => void) | null
    onmessage: ((event: { data: unknown }) => void) | null
    onclose: ((event: { code?: number; reason?: string }) => void) | null
    onerror: ((error: unknown) => void) | null
}

type WebSocketCtor = new (url: string, options: { headers: Record<string, string> }) => WebSocketLike

/** Backend request id: `8-4-4-8` hex groups, NOT a canonical uuid. */
function createRequestId(): string {
    const hex = randomBytes(13).toString('hex')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 24)}`
}

function createSessionId(): string {
    const hex = randomBytes(8).toString('hex')
    return [0, 4, 8, 12].map((start) => hex.slice(start, start + 4)).join('-')
}

/** The xiva topics the web client subscribes to; `+` is the topic separator. */
const XIVA_TOPICS = 'version5*common+version5*main'

function buildXivaUrl(user: string): string {
    const query = new URLSearchParams({
        service: `messenger-prod:${XIVA_TOPICS}`,
        session: createSessionId(),
        client: 'web_main',
        user
    })
    // URLSearchParams percent-encodes `:` and `+`; a literal `+` in the query means a
    // space and xiva closes the socket with `4400 invalid argument "service"`.
    return `wss://push.yandex.ru/v2/subscribe/websocket?${query.toString()}`
}

function isAuthCloseReason(reason: string | undefined): boolean {
    if (!reason) return false
    const normalized = reason.toLowerCase()
    return AUTH_CLOSE_REASONS.some((known) => normalized.includes(known))
}

interface PendingRequest {
    method: string
    requestId: string
    resolve: (payload: unknown) => void
    reject: (error: Error) => void
    timer: ReturnType<typeof setTimeout>
}

interface Connection {
    socket: WebSocketLike
    seq: number
    pending: Map<number, PendingRequest>
    subscriptionId: string | undefined
    subscribedWaiters: Array<{ resolve: (id: string) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>
    pingTimer: ReturnType<typeof setTimeout> | undefined
    closed: boolean
    authFailed: boolean
}

export interface XivaClientOptions {
    /** Numeric uid (or guid for guests) for the handshake `user` param. */
    user: string
    cookieHeader: string
    /** Server-initiated push event; payload shapes are not parsed here. */
    onPush: (frame: RawFrame) => void
    /** Cookies rejected: the caller should flip the connection state to error. */
    onAuthFailure: (detail: string) => void
    onConnected?: () => void
}

export class XivaClient {
    private connection: Connection | undefined
    private connecting: Promise<void> | undefined
    private disposed = false
    private reconnectAttempts = 0
    private reconnectTimer: ReturnType<typeof setTimeout> | undefined

    private readonly WebSocketImpl: WebSocketCtor

    constructor(private readonly options: XivaClientOptions, webSocketImpl?: WebSocketCtor) {
        this.WebSocketImpl = webSocketImpl ?? (WebSocket as unknown as WebSocketCtor)
    }

    get subscriptionId(): string | undefined {
        return this.connection?.subscriptionId
    }

    get isConnected(): boolean {
        return this.connection !== undefined && !this.connection.closed
    }

    /** Opens the socket and resolves once the subscription is operational. */
    async connect(): Promise<void> {
        if (this.disposed) throw new Error('xiva client is disposed')
        if (this.connection && !this.connection.closed) {
            await this.waitForSubscriptionId()
            return
        }
        this.connecting ??= this.openConnection()
            .then(async () => {
                await this.waitForSubscriptionId()
                this.reconnectAttempts = 0
                this.options.onConnected?.()
            })
            .finally(() => {
                this.connecting = undefined
            })
        return this.connecting
    }

    /**
     * Sends a DATA frame and awaits the response. Correlates on both transport `reqId`
     * and backend `RequestId`. `push` responses carry commit statuses instead of the
     * generic Status layer, so their payloads bypass the status check.
     */
    async request(method: string, params: Record<string, unknown> = {}, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS): Promise<unknown> {
        const connection = this.requireConnection()
        // Readiness to send arrives on the `subscribed` frame, not on socket open.
        await this.waitForSubscriptionId()
        const requestId = createRequestId()
        const seq = connection.seq
        connection.seq += 1

        const promise = new Promise<unknown>((resolve, reject) => {
            const timer = setTimeout(() => {
                connection.pending.delete(seq)
                reject(new Error(`xiva ${method} timed out after ${timeoutMs}ms`))
            }, timeoutMs)
            connection.pending.set(seq, { method, requestId, resolve, reject, timer })
        })
        const payload = { RequestId: requestId, ...params }
        connection.socket.send(encodeDataFrame({ serviceIndex: 0, reqId: seq, method, payload }))
        const response = await promise
        if (method === PUSH_METHOD) return response
        const status = (response as { Status?: unknown } | undefined)?.Status
        if (status !== undefined && status !== 0) {
            throw new Error(`xiva ${method} failed with Status ${String(status)}`)
        }
        return response
    }

    /** Closes the socket and stops reconnecting. */
    close(): void {
        this.disposed = true
        if (this.reconnectTimer !== undefined) clearTimeout(this.reconnectTimer)
        const connection = this.connection
        this.connection = undefined
        if (!connection) return
        connection.closed = true
        this.failPending(connection, new Error('xiva client closed'))
        for (const waiter of connection.subscribedWaiters) {
            clearTimeout(waiter.timer)
            waiter.reject(new Error('xiva client closed'))
        }
        connection.subscribedWaiters = []
        if (connection.pingTimer !== undefined) clearTimeout(connection.pingTimer)
        try {
            connection.socket.close(1000, 'client shutdown')
        } catch {
        }
    }

    private requireConnection(): Connection {
        if (this.disposed) throw new Error('xiva client is disposed')
        if (!this.connection || this.connection.closed) throw new Error('xiva socket is not connected')
        return this.connection
    }

    /** Resolves with the current connection's subscription id, waiting for `subscribed`. */
    waitForSubscriptionId(): Promise<string> {
        const connection = this.requireConnection()
        if (connection.subscriptionId !== undefined) return Promise.resolve(connection.subscriptionId)
        return new Promise<string>((resolve, reject) => {
            const timer = setTimeout(() => {
                connection.subscribedWaiters = connection.subscribedWaiters.filter((item) => item !== waiter)
                reject(new Error(`xiva: operational 'subscribed' frame did not arrive within ${SUBSCRIBED_TIMEOUT_MS}ms`))
            }, SUBSCRIBED_TIMEOUT_MS)
            const waiter = { resolve, reject, timer }
            connection.subscribedWaiters.push(waiter)
        })
    }

    private async openConnection(): Promise<void> {
        const socket = new this.WebSocketImpl(buildXivaUrl(this.options.user), {
            headers: {
                Cookie: this.options.cookieHeader,
                Origin: 'https://yandex.ru'
            }
        })
        const connection: Connection = {
            socket,
            seq: 1,
            pending: new Map(),
            subscriptionId: undefined,
            subscribedWaiters: [],
            pingTimer: undefined,
            closed: false,
            authFailed: false
        }
        this.connection = connection

        socket.onopen = () => {
            // Listeners attach before open resolves: xiva sends `subscribed` right away.
        }
        socket.onmessage = (event) => {
            this.onMessage(connection, event.data)
        }
        socket.onclose = (event) => {
            if (this.connection !== connection) return
            this.connection = undefined
            connection.closed = true
            this.failPending(connection, new Error(`xiva socket closed (${event?.code ?? '?'})`))
            for (const waiter of connection.subscribedWaiters) {
                clearTimeout(waiter.timer)
                waiter.reject(new Error('xiva socket closed before subscription'))
            }
            connection.subscribedWaiters = []
            if (connection.pingTimer !== undefined) clearTimeout(connection.pingTimer)
            if (this.disposed) return
            if (connection.authFailed || isAuthCloseReason(event?.reason)) {
                this.options.onAuthFailure(event?.reason || 'session cookies rejected')
                return
            }
            this.scheduleReconnect()
        }
        socket.onerror = () => {
            // onclose follows with details; nothing to do here.
        }

        await new Promise<void>((resolve, reject) => {
            const originalOpen = socket.onopen
            const originalClose = socket.onclose
            const timeout = setTimeout(() => {
                reject(new Error('xiva handshake timed out'))
            }, SUBSCRIBED_TIMEOUT_MS)
            socket.onopen = () => {
                socket.onopen = originalOpen
                clearTimeout(timeout)
                resolve()
            }
            socket.onclose = (event) => {
                clearTimeout(timeout)
                originalClose?.(event)
                reject(new Error(`xiva handshake failed: ${event?.reason || event?.code || 'closed'}`))
            }
        })
    }

    private scheduleReconnect(): void {
        if (this.disposed || this.reconnectTimer !== undefined) return
        const delay = Math.min(RECONNECT_BASE_MS * 2 ** this.reconnectAttempts, RECONNECT_MAX_MS)
        this.reconnectAttempts += 1
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = undefined
            this.connect().catch((error) => {
                console.error('[Yandex connector] xiva reconnect failed:', error)
                this.scheduleReconnect()
            })
        }, delay)
    }

    private failPending(connection: Connection, error: Error): void {
        for (const pending of connection.pending.values()) {
            clearTimeout(pending.timer)
            pending.reject(error)
        }
        connection.pending.clear()
    }

    private onMessage(connection: Connection, data: unknown): void {
        if (typeof data === 'string') {
            this.onOperationFrame(connection, data)
            return
        }
        let buffer: Buffer
        try {
            buffer = data instanceof Uint8Array
                ? Buffer.from(data.buffer, data.byteOffset, data.byteLength)
                : Buffer.from(data as ArrayBuffer)
        } catch {
            console.error('[Yandex connector] xiva: unsupported binary frame payload')
            return
        }
        let frame: RawFrame
        try {
            frame = decodeFrame(buffer)
        } catch (error) {
            console.error('[Yandex connector] xiva: frame decode failed:', error)
            return
        }
        if (frame.frameType === FrameType.Data) {
            this.onDataFrame(connection, frame)
            return
        }
        if (frame.frameType === FrameType.ProxyStatus) {
            this.onProxyStatusFrame(connection, frame)
            return
        }
        if (frame.frameType === FrameType.Push) {
            // Server-initiated event: payload shapes are not parsed, consumers diff-refresh.
            this.options.onPush(frame)
            return
        }
    }

    /** Operational text frames of xiva: ping / subscribed / unsubscribe. */
    private onOperationFrame(connection: Connection, raw: string): void {
        let message: { operation?: string; 'subscription-id'?: string; 'server-interval-sec'?: number }
        try {
            message = JSON.parse(raw) as typeof message
        } catch {
            console.error('[Yandex connector] xiva: unparseable operational frame')
            return
        }
        if (message.operation === 'ping') {
            // Liveness: if the next ping does not arrive within the window, the socket is
            // a zombie — close it and let onclose schedule the reconnect.
            const interval = (message['server-interval-sec'] ?? 60) * 1000 * PING_TIMEOUT_FACTOR
            if (connection.pingTimer !== undefined) clearTimeout(connection.pingTimer)
            connection.pingTimer = setTimeout(() => {
                try {
                    connection.socket.close(4000, 'ping timeout')
                } catch {
                }
            }, interval)
            return
        }
        if (message.operation === 'subscribed') {
            const id = message['subscription-id']
            if (typeof id !== 'string' || id.length === 0) return
            connection.subscriptionId = id
            for (const waiter of connection.subscribedWaiters) {
                clearTimeout(waiter.timer)
                waiter.resolve(id)
            }
            connection.subscribedWaiters = []
            return
        }
        if (message.operation === 'unsubscribe') {
            // The server revoked the subscription and cleared credentials: auth failure.
            connection.authFailed = true
            try {
                connection.socket.close()
            } catch {
            }
        }
    }

    private onDataFrame(connection: Connection, frame: RawFrame): void {
        const reqId = frame.elements[1]
        if (typeof reqId !== 'number') return
        const pending = connection.pending.get(reqId)
        if (!pending) return
        connection.pending.delete(reqId)
        clearTimeout(pending.timer)
        const payload = frame.payload as { RequestId?: unknown } | undefined
        const responseRequestId = payload?.RequestId
        if (typeof responseRequestId === 'string' && responseRequestId !== pending.requestId) {
            pending.reject(new Error(`xiva ${pending.method}: response RequestId mismatch`))
            return
        }
        if (pending.method === PUSH_METHOD) {
            pending.resolve(frame.payload)
            return
        }
        const status = (frame.payload as { Status?: unknown } | undefined)?.Status
        if (status !== undefined && status !== 0) {
            pending.reject(new Error(`xiva ${pending.method} failed with Status ${String(status)}`))
            return
        }
        pending.resolve(frame.payload)
    }

    private onProxyStatusFrame(connection: Connection, frame: RawFrame): void {
        const reqId = frame.elements[0]
        const errorCode = frame.elements[1]
        if (typeof reqId !== 'number') return
        const pending = connection.pending.get(reqId)
        if (!pending) return
        connection.pending.delete(reqId)
        clearTimeout(pending.timer)
        const name = typeof errorCode === 'number' ? (TRANSPORT_ERROR_NAMES[errorCode] ?? `UNKNOWN(${errorCode})`) : 'UNKNOWN'
        pending.reject(new Error(`xiva ${pending.method} transport error ${name}`))
    }
}

/** Unique client message id; also the server-side deduplication key. */
export function createPayloadId(): string {
    return randomUUID()
}
