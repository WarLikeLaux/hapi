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
export const APP_CACHE_RESET_STEP_TIMEOUT_MS = 5_000

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    })
    return Promise.race([promise, timeout]).finally(() => {
        if (timer !== undefined) clearTimeout(timer)
    })
}

export async function resetAppCaches(): Promise<{ cachesCleared: number; workersUnregistered: number }> {
    let cachesCleared = 0
    let workersUnregistered = 0

    const cacheStorage: CacheStorage | undefined = typeof caches !== 'undefined' ? caches : undefined
    if (cacheStorage) {
        try {
            const names = await withTimeout(cacheStorage.keys(), APP_CACHE_RESET_STEP_TIMEOUT_MS, 'caches.keys')
            await Promise.all(names.map(async (name) => {
                try {
                    if (await withTimeout(cacheStorage.delete(name), APP_CACHE_RESET_STEP_TIMEOUT_MS, `caches.delete(${name})`)) {
                        cachesCleared += 1
                    }
                } catch (error) {
                    console.warn('App cache entry delete failed:', name, error)
                }
            }))
        } catch (error) {
            console.warn('App cache list failed:', error)
        }
    }

    const serviceWorker = typeof navigator !== 'undefined' && 'serviceWorker' in navigator
        ? navigator.serviceWorker
        : undefined
    if (serviceWorker) {
        try {
            const registrations = await withTimeout(serviceWorker.getRegistrations(), APP_CACHE_RESET_STEP_TIMEOUT_MS, 'serviceWorker.getRegistrations')
            await Promise.all(registrations.map(async (registration) => {
                try {
                    if (await withTimeout(registration.unregister(), APP_CACHE_RESET_STEP_TIMEOUT_MS, 'serviceWorker.unregister')) {
                        workersUnregistered += 1
                    }
                } catch (error) {
                    console.warn('Service worker unregister failed:', error)
                }
            }))
        } catch (error) {
            console.warn('Service worker list failed:', error)
        }
    }

    return { cachesCleared, workersUnregistered }
}
