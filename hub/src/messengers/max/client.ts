/**
 * Personal MAX web protocol. References (not copied library code):
 * https://github.com/pr0bel1230/max-api-docs (CC BY 4.0)
 * https://github.com/ounezz/umax
 */
import type { ConfigureMaxRequest } from '@hapi/protocol'

export type MaxObject = Record<string, unknown>
export function object(value: unknown): MaxObject {
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as MaxObject : {}
}
export function objects(value: unknown): MaxObject[] {
    return Array.isArray(value) ? value.map(object) : []
}
export function id(value: unknown): string | null {
    if (typeof value === 'string' && /^-?\d+$/.test(value)) return value
    return typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : null
}
export function number(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

export type MaxPacket = { cmd: number; seq: number; opcode: number; payload: MaxObject }
type Pending = {
    opcode: number
    resolve: (payload: MaxObject) => void
    reject: (error: Error) => void
    timer: ReturnType<typeof setTimeout>
}

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const REQUEST_TIMEOUT_MS = 15_000

class MaxRequestError extends Error {
    constructor(readonly opcode: number) {
        // Server text/payload may echo credentials. Never surface it in logs or REST.
        super(opcode === 19
            ? 'MAX rejected this session. Copy a fresh token and device ID from web.max.ru.'
            : `MAX request failed (operation ${opcode})`)
    }
}

export class MaxClient {
    private socket: WebSocket | null = null
    private pending = new Map<number, Pending>()
    private seq = 0
    private connecting: Promise<void> | null = null
    private stopped = false
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null
    private heartbeat: ReturnType<typeof setInterval> | null = null
    private retry = 0
    private rejectOpen: ((error: Error) => void) | null = null
    private readonly attachmentWaiters = new Map<string, {
        resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout>
    }>()

    constructor(private readonly options: {
        credentials: ConfigureMaxRequest
        onReady: (snapshot: MaxObject) => void
        onState: (state: 'starting' | 'error', detail: string) => void
        onPush: (packet: MaxPacket) => void
    }) {}

    connect(): Promise<void> {
        if (this.stopped) return Promise.reject(new Error('MAX connection is closed'))
        if (this.connecting) return this.connecting
        this.connecting = this.open().catch((error: unknown) => {
            const permanent = error instanceof MaxRequestError && error.opcode === 19
            const detail = error instanceof Error ? error.message : 'MAX connection failed'
            if (permanent) this.stopped = true
            this.disconnect()
            this.options.onState(permanent ? 'error' : 'starting', detail)
            if (!permanent) this.scheduleReconnect()
            throw error
        }).finally(() => { this.connecting = null })
        return this.connecting
    }

    request(opcode: number, payload: MaxObject = {}): Promise<MaxObject> {
        const socket = this.socket
        if (!socket || socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error('MAX is reconnecting'))
        const seq = ++this.seq
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(seq)
                reject(new Error(`MAX request timed out (operation ${opcode})`))
            }, REQUEST_TIMEOUT_MS)
            // Register before sending: a response may arrive immediately.
            this.pending.set(seq, { opcode, resolve, reject, timer })
            try {
                socket.send(JSON.stringify({ ver: 11, cmd: 0, seq, opcode, payload }))
            } catch {
                clearTimeout(timer)
                this.pending.delete(seq)
                reject(new Error('MAX connection interrupted'))
            }
        })
    }

    /** Register before HTTP upload; the processing notification can arrive during it. */
    waitForAttachment(fileId: string): { ready: Promise<void>; cancel: () => void } {
        const ready = new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.attachmentWaiters.delete(fileId)
                reject(new Error('MAX attachment processing timed out'))
            }, 60_000)
            this.attachmentWaiters.set(fileId, { resolve, reject, timer })
        })
        // A disconnect may reject while the HTTP upload is still in progress.
        void ready.catch(() => {})
        return { ready, cancel: () => {
            const waiter = this.attachmentWaiters.get(fileId)
            if (!waiter) return
            clearTimeout(waiter.timer)
            this.attachmentWaiters.delete(fileId)
            waiter.reject(new Error('MAX attachment upload interrupted'))
        } }
    }

    stop(): void {
        this.stopped = true
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
        this.reconnectTimer = null
        this.disconnect()
    }

    private async open(): Promise<void> {
        this.disconnect()
        this.seq = 0
        const socket = new WebSocket('wss://ws-api.oneme.ru/websocket', {
            headers: { Origin: 'https://web.max.ru', 'User-Agent': USER_AGENT }
        })
        this.socket = socket
        socket.onmessage = (event) => {
            if (this.socket !== socket || typeof event.data !== 'string') return
            try {
                // Bun supplies reviver context.source, preserving MAX's 64-bit ids.
                const packet = object(JSON.parse(event.data, (_key, value: unknown, context?: { source?: string }) =>
                    typeof value === 'number' && !Number.isSafeInteger(value) && context?.source && /^-?\d+$/.test(context.source)
                        ? context.source : value))
                this.receive({ cmd: number(packet.cmd), seq: number(packet.seq), opcode: number(packet.opcode), payload: object(packet.payload) })
            } catch {
                this.disconnect()
                if (!this.stopped) {
                    this.options.onState('starting', 'MAX sent an unsupported response. Reconnecting…')
                    this.scheduleReconnect()
                }
            }
        }
        socket.onclose = () => {
            if (this.socket !== socket) return
            this.disconnect()
            if (!this.stopped) {
                this.options.onState('starting', 'MAX connection interrupted. Reconnecting…')
                this.scheduleReconnect()
            }
        }
        await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('MAX connection timed out')), REQUEST_TIMEOUT_MS)
            this.rejectOpen = (error) => { clearTimeout(timer); reject(error) }
            socket.onopen = () => { clearTimeout(timer); this.rejectOpen = null; resolve() }
            socket.onerror = () => this.rejectOpen?.(new Error('Could not connect to MAX'))
        })
        await this.request(6, {
            deviceId: this.options.credentials.deviceId,
            userAgent: {
                deviceType: 'WEB', locale: 'ru', deviceLocale: 'ru', osVersion: 'Windows',
                deviceName: 'Chrome', headerUserAgent: USER_AGENT, appVersion: '26.4.7',
                screen: '1920x1080 1x', timezone: 'Europe/Moscow'
            }
        })
        const snapshot = await this.request(19, {
            token: this.options.credentials.token, deviceId: this.options.credentials.deviceId,
            interactive: true, chatsCount: 100
        })
        if (!id(object(object(snapshot.profile).contact).id)) throw new MaxRequestError(19)
        if (this.stopped) throw new Error('MAX connection is closed')
        this.retry = 0
        this.options.onReady(snapshot)
        this.heartbeat = setInterval(() => {
            void this.request(1, { interactive: false }).catch(() => {
                if (this.socket !== socket) return
                this.disconnect()
                this.options.onState('starting', 'MAX connection interrupted. Reconnecting…')
                this.scheduleReconnect()
            })
        }, 25_000)
    }

    private receive(packet: MaxPacket): void {
        const pending = this.pending.get(packet.seq)
        if ((packet.cmd === 1 || packet.cmd === 3) && pending && pending.opcode === packet.opcode) {
            clearTimeout(pending.timer)
            this.pending.delete(packet.seq)
            if (packet.cmd === 3 || packet.payload.error) pending.reject(new MaxRequestError(packet.opcode))
            else pending.resolve(packet.payload)
            return
        }
        if (packet.opcode === 136) {
            const fileId = id(packet.payload.fileId)
            const waiter = fileId ? this.attachmentWaiters.get(fileId) : undefined
            if (waiter && fileId) {
                clearTimeout(waiter.timer)
                this.attachmentWaiters.delete(fileId)
                waiter.resolve()
            }
        }
        if (packet.cmd === 0) this.options.onPush(packet)
    }

    private disconnect(): void {
        const socket = this.socket
        this.socket = null
        if (this.heartbeat) clearInterval(this.heartbeat)
        this.heartbeat = null
        this.rejectOpen?.(new Error('MAX connection interrupted'))
        this.rejectOpen = null
        for (const pending of this.pending.values()) {
            clearTimeout(pending.timer)
            pending.reject(new Error('MAX connection interrupted'))
        }
        this.pending.clear()
        for (const waiter of this.attachmentWaiters.values()) {
            clearTimeout(waiter.timer)
            waiter.reject(new Error('MAX connection interrupted'))
        }
        this.attachmentWaiters.clear()
        if (socket) {
            socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null
            socket.close()
        }
    }

    private scheduleReconnect(): void {
        if (this.stopped || this.reconnectTimer) return
        const delay = Math.min(1_000 * 2 ** Math.min(this.retry++, 5), 30_000)
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null
            void this.connect().catch(() => {})
        }, delay)
    }
}
