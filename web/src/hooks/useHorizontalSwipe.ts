import { useEffect, useRef, type RefObject } from 'react'

type SwipeDirection = 'left' | 'right'

export type HorizontalSwipeOptions = {
    /** Minimum horizontal distance for a gesture to count as a swipe (px). */
    minDistance?: number
    /** Maximum gesture duration (ms). */
    maxDuration?: number
    /** |dx| must exceed |dy| multiplied by this factor. */
    dominance?: number
    /** Extra CSS selector; touches starting inside matching elements are ignored. */
    ignoreSelector?: string
}

type HorizontalSwipeHandlers = {
    onSwipeLeft?: () => void
    onSwipeRight?: () => void
}

const DEFAULT_OPTIONS = { minDistance: 64, maxDuration: 600, dominance: 2 }

/**
 * A swipe must not start inside a text-entry control, and never starts inside
 * a natively horizontally scrollable element (code blocks, diff panes, the
 * context tab bar): a swipe there scrolls them instead of navigating.
 */
function startsInExcludedArea(target: EventTarget | null, ignoreSelector: string | undefined): boolean {
    if (!(target instanceof Element)) return true
    if (target.closest('input, textarea, select, [contenteditable="true"]')) return true
    if (ignoreSelector && target.closest(ignoreSelector)) return true
    let el: HTMLElement | null = target instanceof HTMLElement ? target : target.parentElement
    while (el && el !== document.body) {
        if (el.scrollWidth > el.clientWidth + 1) {
            const overflowX = getComputedStyle(el).overflowX
            if (overflowX === 'auto' || overflowX === 'scroll') return true
        }
        el = el.parentElement
    }
    return false
}

/**
 * Touch-only horizontal swipe detection for a container.
 *
 * Only deliberate swipes count: fast, mostly horizontal, single finger.
 * Handlers are kept in a ref, so the listeners bind once while the callbacks
 * can close over fresh render state. Used for session list tab switching and
 * phone navigation between the chat, session list, and diff views.
 */
export function useHorizontalSwipe(
    targetRef: RefObject<HTMLElement | null>,
    handlers: HorizontalSwipeHandlers,
    options: HorizontalSwipeOptions = {}
): void {
    const latestRef = useRef({ handlers, options })
    useEffect(() => {
        latestRef.current = { handlers, options }
    })

    useEffect(() => {
        const target = targetRef.current
        if (!target) return

        let startX = 0
        let startY = 0
        let startTime = 0
        let tracking = false

        const handleTouchStart = (event: TouchEvent) => {
            if (event.touches.length !== 1) {
                tracking = false
                return
            }
            const touch = event.touches[0]
            if (!touch) return
            tracking = !startsInExcludedArea(event.target, latestRef.current.options.ignoreSelector)
            startX = touch.clientX
            startY = touch.clientY
            startTime = Date.now()
        }

        const handleTouchEnd = (event: TouchEvent) => {
            if (!tracking) return
            tracking = false
            const touch = event.changedTouches[0]
            if (!touch) return
            const { minDistance, maxDuration, dominance } = {
                ...DEFAULT_OPTIONS,
                ...latestRef.current.options,
            }
            const dx = touch.clientX - startX
            const dy = touch.clientY - startY
            if (Date.now() - startTime > maxDuration) return
            if (Math.abs(dx) < minDistance || Math.abs(dx) < Math.abs(dy) * dominance) return
            const direction: SwipeDirection = dx < 0 ? 'left' : 'right'
            if (direction === 'left') {
                latestRef.current.handlers.onSwipeLeft?.()
            } else {
                latestRef.current.handlers.onSwipeRight?.()
            }
        }

        const handleTouchCancel = () => {
            tracking = false
        }

        target.addEventListener('touchstart', handleTouchStart, { passive: true })
        target.addEventListener('touchend', handleTouchEnd, { passive: true })
        target.addEventListener('touchcancel', handleTouchCancel, { passive: true })
        return () => {
            target.removeEventListener('touchstart', handleTouchStart)
            target.removeEventListener('touchend', handleTouchEnd)
            target.removeEventListener('touchcancel', handleTouchCancel)
        }
    }, [targetRef])
}
