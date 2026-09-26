import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
    PWA_UPDATE_CHECK_INTERVAL_MS,
    PWA_UPDATE_RELOAD_FALLBACK_MS,
    requestPwaUpdateReload,
    setupRegistrationUpdateChecks,
    usePwaUpdate,
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

describe('requestPwaUpdateReload', () => {
    it('reloads immediately when updateSW is unavailable', async () => {
        const reloadPage = vi.fn()

        await requestPwaUpdateReload(null, { reloadPage })

        expect(reloadPage).toHaveBeenCalledTimes(1)
    })

    it('calls updateSW and reloads on controllerchange', async () => {
        const updateSW = vi.fn().mockImplementation(async () => {
            for (const listener of serviceWorkerListeners.get('controllerchange') ?? []) {
                listener(new Event('controllerchange'))
            }
        })
        const reloadPage = vi.fn()

        await requestPwaUpdateReload(updateSW, { reloadPage })

        expect(updateSW).toHaveBeenCalledWith(true)
        expect(reloadPage).toHaveBeenCalledTimes(1)
    })

    it('falls back to reload when controllerchange never fires', async () => {
        vi.useFakeTimers()

        const updateSW = vi.fn().mockResolvedValue(undefined)
        const reloadPage = vi.fn()

        const pending = requestPwaUpdateReload(updateSW, {
            reloadPage,
            setTimeoutFn: vi.fn((callback, delay) => {
                expect(delay).toBe(PWA_UPDATE_RELOAD_FALLBACK_MS)
                return setTimeout(callback, delay)
            }) as unknown as typeof setTimeout,
        })

        await pending
        vi.runAllTimers()

        expect(updateSW).toHaveBeenCalledWith(true)
        expect(reloadPage).toHaveBeenCalledTimes(1)

        vi.useRealTimers()
    })
})

describe('usePwaUpdate', () => {
    let capturedOptions: {
        onNeedRefresh?: () => void
        onRegistered?: (registration: ServiceWorkerRegistration | undefined) => void
    } = {}
    const updateSW = vi.fn().mockResolvedValue(undefined)

    beforeEach(() => {
        capturedOptions = {}
        updateSW.mockReset()
        updateSW.mockImplementation(() => new Promise(() => {}))
        registerSWMock.mockImplementation((options) => {
            capturedOptions = options
            return updateSW
        })
    })

    it('surfaces a banner when registerSW reports an update and a controller exists', async () => {
        setServiceWorkerController({} as ServiceWorker)

        const { result } = renderHook(() => usePwaUpdate())

        expect(registerSWMock).toHaveBeenCalledTimes(1)
        expect(result.current.needRefresh).toBe(false)

        await act(async () => {
            capturedOptions.onNeedRefresh?.()
            await Promise.resolve()
        })

        expect(result.current.needRefresh).toBe(true)
        expect(updateSW).not.toHaveBeenCalled()
    })

    it('does not surface a banner on a fresh install with no controller', async () => {
        setServiceWorkerController(null)

        const { result } = renderHook(() => usePwaUpdate())

        await act(async () => {
            capturedOptions.onNeedRefresh?.()
            await Promise.resolve()
        })

        expect(result.current.needRefresh).toBe(false)
        expect(updateSW).not.toHaveBeenCalled()
    })

    it('only surfaces the banner once for duplicate update signals', async () => {
        setServiceWorkerController({} as ServiceWorker)

        const { result } = renderHook(() => usePwaUpdate())

        await act(async () => {
            capturedOptions.onNeedRefresh?.()
            capturedOptions.onNeedRefresh?.()
            await Promise.resolve()
        })

        expect(result.current.needRefresh).toBe(true)
        expect(updateSW).not.toHaveBeenCalled()
    })

    it('clears the banner when reload is invoked manually', async () => {
        setServiceWorkerController({} as ServiceWorker)
        const localUpdateSW = vi.fn().mockImplementation(() => new Promise(() => {}))
        registerSWMock.mockImplementation((options) => {
            capturedOptions = options
            return localUpdateSW
        })

        const { result } = renderHook(() => usePwaUpdate())

        await act(async () => {
            capturedOptions.onNeedRefresh?.()
            await Promise.resolve()
        })

        expect(result.current.needRefresh).toBe(true)

        await act(async () => {
            result.current.reload()
        })

        expect(result.current.needRefresh).toBe(false)
        expect(localUpdateSW).toHaveBeenCalledWith(true)
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

    it('surfaces a banner when a worker is already waiting on registration', async () => {
        setServiceWorkerController({} as ServiceWorker)

        const registration = {
            waiting: {} as ServiceWorker,
            update: vi.fn().mockResolvedValue(undefined),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
        } as unknown as ServiceWorkerRegistration

        const { result } = renderHook(() => usePwaUpdate())

        await act(async () => {
            capturedOptions.onRegistered?.(registration)
            await Promise.resolve()
        })

        expect(result.current.needRefresh).toBe(true)
        expect(updateSW).not.toHaveBeenCalled()
    })

    it('does not surface a waiting worker on registration when no controller exists', async () => {
        setServiceWorkerController(null)

        const registration = {
            waiting: {} as ServiceWorker,
            update: vi.fn().mockResolvedValue(undefined),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
        } as unknown as ServiceWorkerRegistration

        const { result } = renderHook(() => usePwaUpdate())

        await act(async () => {
            capturedOptions.onRegistered?.(registration)
            await Promise.resolve()
        })

        expect(result.current.needRefresh).toBe(false)
    })
})
