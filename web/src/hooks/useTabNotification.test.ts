import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
    APP_TITLE,
    DEFAULT_FAVICON,
    formatUnreadTitle,
    getUnreadBadgeIcon,
    TAB_BLINK_INTERVAL_MS,
    useTabNotification,
} from './useTabNotification'

function setVisibilityState(state: DocumentVisibilityState): void {
    Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        value: state,
    })
}

function getFaviconHref(): string | null {
    const link = document.querySelector<HTMLLinkElement>("link[rel*='icon']")
    return link ? link.getAttribute('href') : null
}

describe('useTabNotification helpers', () => {
    it('formats unread titles correctly', () => {
        expect(formatUnreadTitle(0)).toBe(APP_TITLE)
        expect(formatUnreadTitle(-1)).toBe(APP_TITLE)
        expect(formatUnreadTitle(1)).toBe('1 new message')
        expect(formatUnreadTitle(2)).toBe('2 new messages')
        expect(formatUnreadTitle(10)).toBe('10 new messages')
    })

    it('selects badge icons accurately', () => {
        expect(getUnreadBadgeIcon(0)).toBe(DEFAULT_FAVICON)
        expect(getUnreadBadgeIcon(1)).toBe('/badge-1.png')
        expect(getUnreadBadgeIcon(5)).toBe('/badge-5.png')
        expect(getUnreadBadgeIcon(9)).toBe('/badge-9.png')
        expect(getUnreadBadgeIcon(10)).toBe('/badge-9plus.png')
        expect(getUnreadBadgeIcon(99)).toBe('/badge-9plus.png')
    })
})

describe('useTabNotification hook', () => {
    beforeEach(() => {
        vi.useFakeTimers()
        setVisibilityState('visible')
        document.title = APP_TITLE
        document.head.innerHTML = '<link rel="icon" href="/icon.png" />'
    })

    afterEach(() => {
        vi.clearAllTimers()
        vi.useRealTimers()
        setVisibilityState('visible')
    })

    it('keeps title and favicon default when document is visible even with unread messages', () => {
        renderHook(() => useTabNotification(3))

        expect(document.title).toBe(APP_TITLE)
        expect(getFaviconHref()).toBe(DEFAULT_FAVICON)

        act(() => {
            vi.advanceTimersByTime(TAB_BLINK_INTERVAL_MS * 3)
        })

        expect(document.title).toBe(APP_TITLE)
        expect(getFaviconHref()).toBe(DEFAULT_FAVICON)
    })

    it('blinks title and favicon when document is hidden and unread count is greater than 0', () => {
        setVisibilityState('hidden')
        renderHook(() => useTabNotification(1))

        // Phase 1 immediately triggers on hidden with unread
        expect(document.title).toBe('1 new message')
        expect(getFaviconHref()).toBe('/badge-1.png')

        // After 1 interval -> Phase 0 (App)
        act(() => {
            vi.advanceTimersByTime(TAB_BLINK_INTERVAL_MS)
        })
        expect(document.title).toBe(APP_TITLE)
        expect(getFaviconHref()).toBe(DEFAULT_FAVICON)

        // After 2 intervals -> Phase 1 (Alert)
        act(() => {
            vi.advanceTimersByTime(TAB_BLINK_INTERVAL_MS)
        })
        expect(document.title).toBe('1 new message')
        expect(getFaviconHref()).toBe('/badge-1.png')
    })

    it('stops blinking and resets title and favicon when document becomes visible', () => {
        setVisibilityState('hidden')
        renderHook(() => useTabNotification(2))

        expect(document.title).toBe('2 new messages')
        expect(getFaviconHref()).toBe('/badge-2.png')

        // User switches back to tab
        setVisibilityState('visible')
        act(() => {
            document.dispatchEvent(new Event('visibilitychange'))
        })

        expect(document.title).toBe(APP_TITLE)
        expect(getFaviconHref()).toBe(DEFAULT_FAVICON)

        // Ensure timer is stopped and no further blinking occurs
        act(() => {
            vi.advanceTimersByTime(TAB_BLINK_INTERVAL_MS * 5)
        })
        expect(document.title).toBe(APP_TITLE)
        expect(getFaviconHref()).toBe(DEFAULT_FAVICON)
    })

    it('resets title and favicon on unmount', () => {
        setVisibilityState('hidden')
        const { unmount } = renderHook(() => useTabNotification(4))

        expect(document.title).toBe('4 new messages')
        expect(getFaviconHref()).toBe('/badge-4.png')

        unmount()

        expect(document.title).toBe(APP_TITLE)
        expect(getFaviconHref()).toBe(DEFAULT_FAVICON)
    })
})
