import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
    PWA_UPDATE_CHECK_INTERVAL_MS,
    PWA_UPDATING_INDICATOR_MS,
    setupRegistrationUpdateChecks,
    usePwaUpdate,
} from '@/hooks/usePwaUpdate'

const originalLocation = window.location
const serviceWorkerListeners = new Map<string, Set<EventListener>>()

function ensureServiceWorkerMock() {
    if (!('controller' in navigator.serviceWorker)) {
        Object.defineProperty(navigator.serviceWorker, 'controller', {
            configurable: true,
            value: null,
        })
    }
}

function setServiceWorkerController(value: ServiceWorker | null) {
    Object.defineProperty(navigator.serviceWorker, 'controller', {
        configurable: true,
        value,
    })
}

function stubLocationReload(): { reloadMock: ReturnType<typeof vi.fn> } {
    const reloadMock = vi.fn()
    Object.defineProperty(window, 'location', {
        configurable: true,
        value: { ...window.location, reload: reloadMock },
    })
    return { reloadMock }
}

function restoreLocationReload() {
    Object.defineProperty(window, 'location', {
        configurable: true,
        value: originalLocation,
    })
}

beforeEach(() => {
    serviceWorkerListeners.clear()
    Object.defineProperty(navigator, 'serviceWorker', {
        configurable: true,
        value: {
            controller: null,
            register: vi.fn(),
            addEventListener: (type: string, listener: EventListener) => {
                const bucket = serviceWorkerListeners.get(type) ?? new Set<EventListener>()
                bucket.add(listener)
                serviceWorkerListeners.set(type, bucket)
            },
            removeEventListener: (type: string, listener: EventListener) => {
                serviceWorkerListeners.get(type)?.delete(listener)
            },
        },
    })
    ensureServiceWorkerMock()
    setServiceWorkerController(null)
})

describe('setupRegistrationUpdateChecks', () => {
    beforeEach(() => {
        vi.useFakeTimers()
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    it('checks for updates on an hourly interval', () => {
        const registration = {
            update: vi.fn().mockResolvedValue(undefined),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
        } as unknown as ServiceWorkerRegistration

        const cleanup = setupRegistrationUpdateChecks(registration)

        expect(registration.update).toHaveBeenCalledTimes(1)

        vi.advanceTimersByTime(PWA_UPDATE_CHECK_INTERVAL_MS)
        expect(registration.update).toHaveBeenCalledTimes(2)

        vi.advanceTimersByTime(PWA_UPDATE_CHECK_INTERVAL_MS)
        expect(registration.update).toHaveBeenCalledTimes(3)

        cleanup()
    })

    it('checks for updates when the tab becomes visible', () => {
        const registration = {
            update: vi.fn().mockResolvedValue(undefined),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
        } as unknown as ServiceWorkerRegistration

        const cleanup = setupRegistrationUpdateChecks(registration)

        expect(registration.update).toHaveBeenCalledTimes(1)

        Object.defineProperty(document, 'visibilityState', {
            configurable: true,
            value: 'hidden',
        })
        document.dispatchEvent(new Event('visibilitychange'))
        expect(registration.update).toHaveBeenCalledTimes(1)

        Object.defineProperty(document, 'visibilityState', {
            configurable: true,
            value: 'visible',
        })
        document.dispatchEvent(new Event('visibilitychange'))
        expect(registration.update).toHaveBeenCalledTimes(2)

        cleanup()
    })

    it('removes listeners and clears the interval on cleanup', () => {
        const registration = {
            update: vi.fn().mockResolvedValue(undefined),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
        } as unknown as ServiceWorkerRegistration
        const removeEventListenerSpy = vi.spyOn(document, 'removeEventListener')
        const clearIntervalSpy = vi.spyOn(window, 'clearInterval')

        const cleanup = setupRegistrationUpdateChecks(registration)
        cleanup()

        expect(removeEventListenerSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function))
        expect(clearIntervalSpy).toHaveBeenCalled()
        expect(registration.removeEventListener).toHaveBeenCalledWith(
            'updatefound',
            expect.any(Function),
        )
    })

    it('surfaces a waiting worker on registration when a controller already exists', () => {
        const onUpdateWaiting = vi.fn()
        setServiceWorkerController({} as ServiceWorker)
        const registration = {
            waiting: {} as ServiceWorker,
            update: vi.fn().mockResolvedValue(undefined),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
        } as unknown as ServiceWorkerRegistration

        const cleanup = setupRegistrationUpdateChecks(registration, onUpdateWaiting)

        expect(onUpdateWaiting).toHaveBeenCalled()

        cleanup()
    })

    it('detects a worker that was already installing when registration completed', () => {
        setServiceWorkerController({} as ServiceWorker)
        const worker = Object.assign(new EventTarget(), { state: 'installing' }) as unknown as ServiceWorker
        const registration = Object.assign(new EventTarget(), {
            installing: worker,
            waiting: null,
            update: vi.fn().mockResolvedValue(undefined),
        }) as unknown as ServiceWorkerRegistration
        const onUpdateWaiting = vi.fn()
        const cleanup = setupRegistrationUpdateChecks(registration, onUpdateWaiting)

        Object.assign(worker, { state: 'installed' })
        Object.assign(registration, { waiting: worker })
        worker.dispatchEvent(new Event('statechange'))
        expect(onUpdateWaiting).toHaveBeenCalled()
        cleanup()
    })

    it('does not surface a waiting worker on a fresh install without a controller', () => {
        const onUpdateWaiting = vi.fn()
        setServiceWorkerController(null)
        const registration = {
            waiting: {} as ServiceWorker,
            update: vi.fn().mockResolvedValue(undefined),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
        } as unknown as ServiceWorkerRegistration

        const cleanup = setupRegistrationUpdateChecks(registration, onUpdateWaiting)

        expect(onUpdateWaiting).not.toHaveBeenCalled()

        cleanup()
    })
})

describe('usePwaUpdate', () => {
    let reloadMock: ReturnType<typeof vi.fn>

    function createRegistration(waiting: ServiceWorker | null = null) {
        return Object.assign(new EventTarget(), {
            waiting,
            installing: null as ServiceWorker | null,
            update: vi.fn().mockResolvedValue(undefined),
        }) as unknown as ServiceWorkerRegistration
    }

    async function mountWithRegistration(registration: ServiceWorkerRegistration) {
        vi.mocked(navigator.serviceWorker.register).mockResolvedValue(registration)
        const hook = renderHook(() => usePwaUpdate())
        await act(async () => {})
        return hook
    }

    function dispatchControllerChange(controller: ServiceWorker | null) {
        setServiceWorkerController(controller)
        for (const listener of serviceWorkerListeners.get('controllerchange') ?? []) {
            listener(new Event('controllerchange'))
        }
    }

    beforeEach(() => {
        vi.useFakeTimers()
        ;({ reloadMock } = stubLocationReload())
    })

    afterEach(() => {
        restoreLocationReload()
        vi.useRealTimers()
    })

    it('does not interrupt a fresh install with a waiting worker and no controller', async () => {
        const worker = { postMessage: vi.fn() } as unknown as ServiceWorker
        const { result } = await mountWithRegistration(createRegistration(worker))

        act(() => {
            vi.advanceTimersByTime(10_000)
        })

        expect(result.current.updating).toBe(false)
        expect(worker.postMessage).not.toHaveBeenCalled()
        expect(reloadMock).not.toHaveBeenCalled()
    })

    it('applies an existing waiting worker once and waits for it to control the page before reloading', async () => {
        const previousController = {} as ServiceWorker
        setServiceWorkerController(previousController)
        const worker = { postMessage: vi.fn() } as unknown as ServiceWorker
        const registration = createRegistration(worker)
        const { result } = await mountWithRegistration(registration)

        expect(result.current.updating).toBe(true)
        expect(worker.postMessage).not.toHaveBeenCalled()
        act(() => {
            // Duplicate visibility/update checks must not restart activation.
            document.dispatchEvent(new Event('visibilitychange'))
            vi.advanceTimersByTime(10_000)
        })

        expect(worker.postMessage).toHaveBeenCalledTimes(1)
        expect(worker.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' })
        expect(reloadMock).not.toHaveBeenCalled()
        act(() => dispatchControllerChange(previousController))
        expect(reloadMock).not.toHaveBeenCalled()

        act(() => {
            dispatchControllerChange(worker)
            dispatchControllerChange(worker)
        })
        expect(reloadMock).toHaveBeenCalledTimes(1)
    })

    it('reloads for a later update even when the page started as a fresh install', async () => {
        const registration = createRegistration()
        const { result } = await mountWithRegistration(registration)
        act(() => dispatchControllerChange({} as ServiceWorker))
        expect(result.current.updating).toBe(false)
        expect(reloadMock).not.toHaveBeenCalled()

        const worker = Object.assign(new EventTarget(), {
            state: 'installing',
            postMessage: vi.fn(),
        }) as unknown as ServiceWorker
        act(() => {
            Object.assign(registration, { installing: worker })
            registration.dispatchEvent(new Event('updatefound'))
            Object.assign(worker, { state: 'installed' })
            Object.assign(registration, { waiting: worker })
            worker.dispatchEvent(new Event('statechange'))
        })
        expect(result.current.updating).toBe(true)
        act(() => vi.advanceTimersByTime(PWA_UPDATING_INDICATOR_MS))
        expect(worker.postMessage).toHaveBeenCalledTimes(1)
        expect(reloadMock).not.toHaveBeenCalled()
        act(() => dispatchControllerChange(worker))
        expect(reloadMock).toHaveBeenCalledTimes(1)
    })

    it('cancels activation and update checks when the provider unmounts', async () => {
        setServiceWorkerController({} as ServiceWorker)
        const worker = { postMessage: vi.fn() } as unknown as ServiceWorker
        const registration = createRegistration(worker)
        const { unmount } = await mountWithRegistration(registration)
        const checksBeforeUnmount = vi.mocked(registration.update).mock.calls.length
        unmount()

        act(() => {
            document.dispatchEvent(new Event('visibilitychange'))
            vi.advanceTimersByTime(PWA_UPDATE_CHECK_INTERVAL_MS)
            dispatchControllerChange(worker)
        })
        expect(worker.postMessage).not.toHaveBeenCalled()
        expect(registration.update).toHaveBeenCalledTimes(checksBeforeUnmount)
        expect(reloadMock).not.toHaveBeenCalled()
    })

    it('ignores registration that finishes after the provider unmounts', async () => {
        let completeRegistration!: (registration: ServiceWorkerRegistration) => void
        vi.mocked(navigator.serviceWorker.register).mockReturnValue(new Promise((resolve) => {
            completeRegistration = resolve
        }))
        const registration = createRegistration()
        const { unmount } = renderHook(() => usePwaUpdate())
        unmount()
        await act(async () => completeRegistration(registration))
        expect(registration.update).not.toHaveBeenCalled()
    })
})
