import { useCallback, useEffect, useRef, useState } from 'react'
import { registerSW } from 'virtual:pwa-register'

export const PWA_UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000
export const PWA_UPDATE_RELOAD_FALLBACK_MS = 2000

export async function requestPwaUpdateReload(
    updateSW: ((reloadPage?: boolean) => Promise<void>) | null | undefined,
    options: {
        reloadPage?: () => void
        setTimeoutFn?: typeof setTimeout
        clearTimeoutFn?: typeof clearTimeout
    } = {},
): Promise<void> {
    const reloadPage = options.reloadPage ?? (() => window.location.reload())
    const setTimeoutFn = options.setTimeoutFn ?? setTimeout
    const clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout

    if (!updateSW) {
        reloadPage()
        return
    }

    let reloaded = false
    const doReload = () => {
        if (reloaded) {
            return
        }
        reloaded = true
        reloadPage()
    }

    const onControllerChange = () => {
        navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange)
        doReload()
    }

    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange)

    let fallbackTimer: ReturnType<typeof setTimeout> | undefined

    try {
        await updateSW(true)
    } catch (error) {
        console.error('PWA update failed', error)
        navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange)
        if (fallbackTimer !== undefined) {
            clearTimeoutFn(fallbackTimer)
        }
        doReload()
        return
    }

    fallbackTimer = setTimeoutFn(() => {
        navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange)
        doReload()
    }, PWA_UPDATE_RELOAD_FALLBACK_MS)
}

export function setupRegistrationUpdateChecks(
    registration: ServiceWorkerRegistration,
    onUpdateWaiting: () => void = () => {},
): () => void {
    const detectWaitingUpdate = () => {
        if (registration.waiting) {
            onUpdateWaiting()
        }
    }

    let observedInstallingWorker: ServiceWorker | null = null

    const handleInstallingStateChange = () => {
        if (
            observedInstallingWorker?.state === 'installed' &&
            navigator.serviceWorker.controller
        ) {
            onUpdateWaiting()
        }
    }

    const observeInstallingWorker = () => {
        observedInstallingWorker?.removeEventListener('statechange', handleInstallingStateChange)
        observedInstallingWorker = registration.installing
        observedInstallingWorker?.addEventListener('statechange', handleInstallingStateChange)
        detectWaitingUpdate()
    }

    const checkForUpdate = () => {
        detectWaitingUpdate()
        void registration.update().then(detectWaitingUpdate).catch((error) => {
            console.error('SW update check failed:', error)
        })
    }

    registration.addEventListener('updatefound', observeInstallingWorker)

    // Browsers are allowed to throttle navigation-triggered service-worker
    // checks. Ask explicitly on every app start so a long-lived HAPI tab does
    // not remain pinned to a stale precache after a local deployment.
    checkForUpdate()

    const intervalId = window.setInterval(() => {
        checkForUpdate()
    }, PWA_UPDATE_CHECK_INTERVAL_MS)

    const handleVisibilityChange = () => {
        if (document.visibilityState === 'visible') {
            checkForUpdate()
        }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
        window.clearInterval(intervalId)
        document.removeEventListener('visibilitychange', handleVisibilityChange)
        registration.removeEventListener('updatefound', observeInstallingWorker)
        observedInstallingWorker?.removeEventListener('statechange', handleInstallingStateChange)
    }
}

export function usePwaUpdate() {
    const [needRefresh, setNeedRefresh] = useState(false)
    const updateSWRef = useRef<((reloadPage?: boolean) => Promise<void>) | null>(null)
    const cleanupRef = useRef<(() => void) | null>(null)
    const updateReloadRequestedRef = useRef(false)

    useEffect(() => {
        const applyWaitingUpdate = () => {
            if (updateReloadRequestedRef.current) {
                return
            }

            updateReloadRequestedRef.current = true

            // registerSW may invoke onRegistered synchronously before returning
            // its update function. Defer activation until the ref is populated.
            queueMicrotask(() => {
                const updateSW = updateSWRef.current
                if (!updateSW) {
                    updateReloadRequestedRef.current = false
                    setNeedRefresh(true)
                    return
                }

                void requestPwaUpdateReload(updateSW)
            })
        }

        const updateSW = registerSW({
            onNeedRefresh() {
                applyWaitingUpdate()
            },
            onOfflineReady() {
                console.log('App ready for offline use')
            },
            onRegistered(registration) {
                cleanupRef.current?.()
                cleanupRef.current = null

                if (!registration) {
                    return
                }

                cleanupRef.current = setupRegistrationUpdateChecks(
                    registration,
                    applyWaitingUpdate,
                )
            },
            onRegisterError(error) {
                console.error('SW registration error:', error)
            },
        })

        updateSWRef.current = updateSW

        return () => {
            cleanupRef.current?.()
            cleanupRef.current = null
            updateSWRef.current = null
            updateReloadRequestedRef.current = false
        }
    }, [])

    const reload = useCallback(() => {
        void requestPwaUpdateReload(updateSWRef.current)
    }, [])

    return { needRefresh, reload }
}
