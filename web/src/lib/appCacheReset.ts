/**
 * Nuclear client refresh for a stuck PWA install: drop every cache-storage
 * entry and unregister every service worker so the next navigation loads the
 * shell from the network and registers a freshly built worker. LocalStorage
 * (saved preferences, drafts, launch settings) is intentionally preserved —
 * this is not a sign-out.
 *
 * Exists because the normal update path (sw.js no-store + skipWaiting +
 * controllerchange reload) can stall on long-lived mobile installs; the About
 * page exposes this as an explicit "clear cache & reload" escape hatch.
 */
export async function resetAppCaches(): Promise<{ cachesCleared: number; workersUnregistered: number }> {
    let cachesCleared = 0
    let workersUnregistered = 0

    const cacheStorage: CacheStorage | undefined = typeof caches !== 'undefined' ? caches : undefined
    if (cacheStorage) {
        const names = await cacheStorage.keys()
        await Promise.all(names.map(async (name) => {
            await cacheStorage.delete(name)
            cachesCleared += 1
        }))
    }

    const serviceWorker = typeof navigator !== 'undefined' && 'serviceWorker' in navigator
        ? navigator.serviceWorker
        : undefined
    if (serviceWorker) {
        const registrations = await serviceWorker.getRegistrations()
        await Promise.all(registrations.map(async (registration) => {
            if (await registration.unregister()) {
                workersUnregistered += 1
            }
        }))
    }

    return { cachesCleared, workersUnregistered }
}
