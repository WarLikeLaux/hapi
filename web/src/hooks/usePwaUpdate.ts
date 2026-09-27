import { useEffect, useState } from 'react'
import { registerSW } from 'virtual:pwa-register'

export const PWA_UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000
export const PWA_UPDATING_INDICATOR_MS = 800

// Module-level guard — survives React component re-mounts within the same
// page load. Multiple SW lifecycle events (onNeedRefresh, registration.waiting
// on first check, install-state transitions, hourly update ticks, visibility
// resumes) all funnel into the same auto-apply path, and any of them firing
// twice must not trigger a second page reload while the first is already in
// flight.
let autoReloadScheduled = false

// Test-only — production callers must not reset the guard. The guard is a
// real, cross-reload invariant in the deployed build; exposing the reset
// hook keeps test isolation honest without making the guard inspectable.
export function __resetAutoReloadGuardForTests() {
    autoReloadScheduled = false
}

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

    useEffect(() => {
        const scheduleAutoReload = () => {
            if (autoReloadScheduled) {
                return
            }
            if (!shouldAutoApplyUpdate()) {
                return
            }
            autoReloadScheduled = true
            setUpdating(true)
            window.setTimeout(() => {
                window.location.reload()
            }, PWA_UPDATING_INDICATOR_MS)
        }

        registerSW({
            onNeedRefresh() {
                scheduleAutoReload()
            },
            onOfflineReady() {
                console.log('App ready for offline use')
            },
            onRegistered(registration) {
                if (!registration) {
                    return
                }
                setupRegistrationUpdateChecks(registration, scheduleAutoReload)
            },
            onRegisterError(error) {
                console.error('SW registration error:', error)
            },
        })
    }, [])

    return { updating }
}
