import { useEffect, useState } from 'react'

export const PWA_UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000
export const PWA_UPDATING_INDICATOR_MS = 800
const PWA_ACTIVATION_TIMEOUT_MS = 30_000

// Surface a waiting service worker as a brief "Updating…" indicator before the
// page reloads. Detection is skipped when no previous controller exists (fresh
// PWA install) so we do not flash the indicator before the app ever loads.
// Detection also requires a real previous controller — not a leftover from a
// prior uninstall — to avoid false positives on a no-store reload that
// re-registers an active worker.
function shouldAutoApplyUpdate(): boolean {
    return navigator.serviceWorker.controller !== null
}

export function setupRegistrationUpdateChecks(
    registration: ServiceWorkerRegistration,
    onUpdateWaiting: () => void = () => {},
): () => void {
    const detectWaitingUpdate = () => {
        if (registration.waiting && shouldAutoApplyUpdate()) {
            onUpdateWaiting()
        }
    }

    let observedInstallingWorker: ServiceWorker | null = null

    const handleInstallingStateChange = () => {
        if (
            observedInstallingWorker?.state === 'installed' &&
            shouldAutoApplyUpdate()
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
    observeInstallingWorker()

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
    const [updating, setUpdating] = useState(false)
    const [updateFailed, setUpdateFailed] = useState(false)

    useEffect(() => {
        if (!('serviceWorker' in navigator)) {
            return
        }
        const serviceWorker = navigator.serviceWorker
        let disposed = false
        let updateWorker: ServiceWorker | null = null
        let activationTimer: number | undefined
        let activationTimeout: number | undefined
        let cleanupChecks: (() => void) | undefined
        let reloading = false

        const handleControllerChange = () => {
            // First installs and unrelated controller changes do not reload.
            // Only navigate once the exact worker we are applying owns this
            // page; a resolved activation request is not proof of that.
            if (!updateWorker || serviceWorker.controller !== updateWorker || reloading) {
                return
            }
            reloading = true
            window.clearTimeout(activationTimer)
            window.clearTimeout(activationTimeout)
            window.location.reload()
        }
        serviceWorker.addEventListener('controllerchange', handleControllerChange)

        const handleWorkerStateChange = () => {
            if (updateWorker?.state === 'redundant') {
                // A later deployment replaced this waiting worker. Release the
                // attempt so the registration checks can apply its successor.
                updateWorker.removeEventListener('statechange', handleWorkerStateChange)
                updateWorker = null
                window.clearTimeout(activationTimer)
                window.clearTimeout(activationTimeout)
                setUpdating(false)
                setUpdateFailed(false)
            } else {
                handleControllerChange()
            }
        }

        const workerUrl = `${import.meta.env.BASE_URL}${import.meta.env.DEV ? 'dev-sw.js?dev-sw' : 'sw.js'}`
        void serviceWorker.register(workerUrl, {
            type: import.meta.env.DEV ? 'module' : 'classic',
        }).then((registration) => {
            if (disposed) {
                return
            }
            cleanupChecks = setupRegistrationUpdateChecks(registration, () => {
                // Check ownership before considering another waiting update.
                handleControllerChange()
                if (disposed || updateWorker || !shouldAutoApplyUpdate() || !registration.waiting) {
                    return
                }
                updateWorker = registration.waiting
                updateWorker.addEventListener('statechange', handleWorkerStateChange)
                setUpdating(true)
                setUpdateFailed(false)
                // Allow the banner to paint, then request activation. Mobile
                // activation can take longer than this delay. Reload only once
                // this worker controls the page, so the old shell cannot start
                // another update loop.
                activationTimer = window.setTimeout(() => {
                    updateWorker?.postMessage({ type: 'SKIP_WAITING' })
                }, PWA_UPDATING_INDICATOR_MS)
                activationTimeout = window.setTimeout(() => {
                    // Keep tracking ownership for a late successful activation,
                    // but never leave a stalled attempt looking busy forever.
                    setUpdating(false)
                    setUpdateFailed(true)
                }, PWA_ACTIVATION_TIMEOUT_MS)
            })
        }).catch((error) => {
            console.error('SW registration error:', error)
        })

        return () => {
            disposed = true
            cleanupChecks?.()
            window.clearTimeout(activationTimer)
            window.clearTimeout(activationTimeout)
            updateWorker?.removeEventListener('statechange', handleWorkerStateChange)
            serviceWorker.removeEventListener('controllerchange', handleControllerChange)
        }
    }, [])

    return { updating, updateFailed }
}
