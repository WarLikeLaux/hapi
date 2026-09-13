import { describe, expect, it } from 'vitest'
import { terminalSocketManagerOptions } from './terminalSocketManagerOptions'

describe('terminalSocketManagerOptions', () => {
    it('keeps polling available on every reconnect', () => {
        expect(terminalSocketManagerOptions.transports).toEqual(['polling', 'websocket'])
        expect(terminalSocketManagerOptions.rememberUpgrade).toBe(false)
        expect(terminalSocketManagerOptions.reconnection).toBe(true)
    })
})
