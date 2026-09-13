import type { ManagerOptions } from 'socket.io-client'

export const terminalSocketManagerOptions = {
    path: '/socket.io/',
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    transports: ['polling', 'websocket'],
    // Always begin reconnects with polling. A previously successful websocket
    // can become unreachable after a hub/proxy restart; remembering the upgrade
    // would strand the terminal in a transport-error loop instead of using the
    // working fallback. Socket.IO still upgrades to websocket when available.
    rememberUpgrade: false,
    autoConnect: false
} satisfies Partial<ManagerOptions>
