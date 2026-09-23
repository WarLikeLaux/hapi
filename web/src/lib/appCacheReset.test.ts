import { describe, expect, it, vi } from 'vitest'
import { resetAppCaches } from './appCacheReset'

describe('resetAppCaches', () => {
    it('deletes every cache and unregisters every worker', async () => {
        const deleted: string[] = []
        vi.stubGlobal('caches', {
            keys: async () => ['workbox-precache', 'cdn-socketio'],
            delete: async (name: string) => {
                deleted.push(name)
                return true
            },
        })
        const registrations = [
            { unregister: vi.fn(async () => true) },
            { unregister: vi.fn(async () => true) },
            { unregister: vi.fn(async () => false) },
        ]
        vi.stubGlobal('navigator', { serviceWorker: { getRegistrations: async () => registrations } })

        await expect(resetAppCaches()).resolves.toEqual({ cachesCleared: 2, workersUnregistered: 2 })

        expect(deleted).toEqual(['workbox-precache', 'cdn-socketio'])
        for (const registration of registrations) {
            expect(registration.unregister).toHaveBeenCalledOnce()
        }
        vi.unstubAllGlobals()
    })

    it('resolves to zeroed counts when the storage APIs are absent', async () => {
        vi.stubGlobal('caches', undefined)
        vi.stubGlobal('navigator', {})

        await expect(resetAppCaches()).resolves.toEqual({ cachesCleared: 0, workersUnregistered: 0 })
        vi.unstubAllGlobals()
    })
})
