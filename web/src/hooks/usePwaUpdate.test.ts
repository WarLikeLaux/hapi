import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
    PWA_UPDATE_CHECK_INTERVAL_MS,
    PWA_UPDATING_INDICATOR_MS,
    setupRegistrationUpdateChecks,
    usePwaUpdate,
    __resetAutoReloadGuardForTests,
} from '@/hooks/usePwaUpdate'

const registerSWMock = vi.fn()
const serviceWorkerListeners = new Map<string, Set<EventListener>>()

vi.mock('virtual:pwa-register', () => ({
    registerSW: (options: Parameters<typeof registerSWMock>[0]) => registerSWMock(options),
}))

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
        value: window.location,
    })
}

beforeEach(() => {
    serviceWorkerListeners.clear()
    Object.defineProperty(navigator, 'serviceWorker', {
        configurable: true,
        value: {
            controller: null,
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
    let capturedOptions: {
        onNeedRefresh?: () => void
        onRegistered?: (registration: ServiceWorkerRegistration | undefined) => void
    } = {}
    let reloadMock: ReturnType<typeof vi.fn>

    beforeEach(() => {
        capturedOptions = {}
        registerSWMock.mockReset()
        registerSWMock.mockImplementation((options) => {
            capturedOptions = options
            return vi.fn()
        })
        ;({ reloadMock } = stubLocationReload())
        __resetAutoReloadGuardForTests()
    })

    afterEach(() => {
        restoreLocationReload()
    })

    it('does not surface the indicator on a fresh install with no controller', () => {
        setServiceWorkerController(null)

        const { result } = renderHook(() => usePwaUpdate())

        expect(registerSWMock).toHaveBeenCalledTimes(1)
        expect(result.current.updating).toBe(false)

        act(() => {
            capturedOptions.onNeedRefresh?.()
        })

        expect(result.current.updating).toBe(false)
        expect(reloadMock).not.toHaveBeenCalled()
    })

    it('surfaces the indicator and schedules a reload when an update is detected and a controller exists', () => {
        vi.useFakeTimers()
        const setTimeoutSpy = vi.spyOn(window, 'setTimeout')
        setServiceWorkerController({} as ServiceWorker)

        const { result } = renderHook(() => usePwaUpdate())

        expect(result.current.updating).toBe(false)

        act(() => {
            capturedOptions.onNeedRefresh?.()
        })

        expect(result.current.updating).toBe(true)
        expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), PWA_UPDATING_INDICATOR_MS)

        act(() => {
            vi.advanceTimersByTime(PWA_UPDATING_INDICATOR_MS)
        })

        expect(reloadMock).toHaveBeenCalledTimes(1)
        setTimeoutSpy.mockRestore()
        vi.useRealTimers()
    })

    it('only triggers a single auto-reload even when onNeedRefresh fires multiple times', () => {
        vi.useFakeTimers()
        const setTimeoutSpy = vi.spyOn(window, 'setTimeout')
        setServiceWorkerController({} as ServiceWorker)

        const { result } = renderHook(() => usePwaUpdate())

        act(() => {
            capturedOptions.onNeedRefresh?.()
            capturedOptions.onNeedRefresh?.()
            capturedOptions.onNeedRefresh?.()
        })

        expect(result.current.updating).toBe(true)
        expect(setTimeoutSpy).toHaveBeenCalledTimes(1)

        act(() => {
            vi.advanceTimersByTime(PWA_UPDATING_INDICATOR_MS)
        })

        expect(reloadMock).toHaveBeenCalledTimes(1)
        setTimeoutSpy.mockRestore()
        vi.useRealTimers()
    })

    it('coalesces onNeedRefresh and onRegistered-triggered waiting detection into a single reload', () => {
        vi.useFakeTimers()
        const setTimeoutSpy = vi.spyOn(window, 'setTimeout')
        setServiceWorkerController({} as ServiceWorker)

        renderHook(() => usePwaUpdate())

        const registration = {
            waiting: {} as ServiceWorker,
            update: vi.fn().mockResolvedValue(undefined),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
        } as unknown as ServiceWorkerRegistration

        act(() => {
            capturedOptions.onNeedRefresh?.()
            capturedOptions.onRegistered?.(registration)
        })

        expect(setTimeoutSpy).toHaveBeenCalledTimes(1)

        act(() => {
            vi.advanceTimersByTime(PWA_UPDATING_INDICATOR_MS)
        })

        expect(reloadMock).toHaveBeenCalledTimes(1)
        setTimeoutSpy.mockRestore()
        vi.useRealTimers()
    })

    it('wires registration update checks from onRegistered', () => {
        vi.useFakeTimers()

        const registration = {
            update: vi.fn().mockResolvedValue(undefined),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
        } as unknown as ServiceWorkerRegistration

        renderHook(() => usePwaUpdate())

        act(() => {
            capturedOptions.onRegistered?.(registration)
        })

        expect(registration.update).toHaveBeenCalledTimes(1)

        vi.advanceTimersByTime(PWA_UPDATE_CHECK_INTERVAL_MS)
        expect(registration.update).toHaveBeenCalledTimes(2)

        vi.useRealTimers()
    })

    it('does not surface the indicator when the waiting worker is detected without a controller', () => {
        setServiceWorkerController(null)

        renderHook(() => usePwaUpdate())

        const registration = {
            waiting: {} as ServiceWorker,
            update: vi.fn().mockResolvedValue(undefined),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
        } as unknown as ServiceWorkerRegistration

        act(() => {
            capturedOptions.onRegistered?.(registration)
        })

        expect(reloadMock).not.toHaveBeenCalled()
    })

    it('does not surface the indicator when registration has no waiting worker', () => {
        setServiceWorkerController({} as ServiceWorker)

        renderHook(() => usePwaUpdate())

        const registration = {
            update: vi.fn().mockResolvedValue(undefined),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
        } as unknown as ServiceWorkerRegistration

        act(() => {
            capturedOptions.onRegistered?.(registration)
        })

        expect(reloadMock).not.toHaveBeenCalled()
    })
})
