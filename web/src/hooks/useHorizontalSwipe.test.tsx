import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { useRef, type ReactNode } from 'react'
import { useHorizontalSwipe } from './useHorizontalSwipe'

type TouchPoint = { clientX: number; clientY: number }

function fireTouch(el: Element, type: 'touchstart' | 'touchend' | 'touchcancel', point: TouchPoint) {
    const event = new Event(type, { bubbles: true })
    Object.defineProperties(event, {
        touches: { value: type === 'touchstart' ? [point] : [] },
        changedTouches: { value: [point] },
    })
    fireEvent(el, event)
}

type ProbeProps = {
    onSwipeLeft?: () => void
    onSwipeRight?: () => void
    ignoreSelector?: string
    children?: ReactNode
}

function SwipeProbe(props: ProbeProps) {
    const ref = useRef<HTMLDivElement>(null)
    useHorizontalSwipe(ref, {
        onSwipeLeft: props.onSwipeLeft,
        onSwipeRight: props.onSwipeRight,
    }, { ignoreSelector: props.ignoreSelector })
    return <div ref={ref}>{props.children}</div>
}

function swipe(el: Element, fromX: number, toX: number, fromY = 100, toY = 100) {
    fireTouch(el, 'touchstart', { clientX: fromX, clientY: fromY })
    fireTouch(el, 'touchend', { clientX: toX, clientY: toY })
}

describe('useHorizontalSwipe', () => {
    it('fires onSwipeLeft for a fast leftward swipe', () => {
        const onSwipeLeft = vi.fn()
        const onSwipeRight = vi.fn()
        const { container } = render(
            <SwipeProbe onSwipeLeft={onSwipeLeft} onSwipeRight={onSwipeRight} />
        )

        swipe(container.firstElementChild!, 300, 220)

        expect(onSwipeLeft).toHaveBeenCalledOnce()
        expect(onSwipeRight).not.toHaveBeenCalled()
    })

    it('fires onSwipeRight for a fast rightward swipe', () => {
        const onSwipeRight = vi.fn()
        const { container } = render(<SwipeProbe onSwipeRight={onSwipeRight} />)

        swipe(container.firstElementChild!, 220, 300)

        expect(onSwipeRight).toHaveBeenCalledOnce()
    })

    it('ignores short and vertical-dominant gestures', () => {
        const onSwipeLeft = vi.fn()
        const { container } = render(<SwipeProbe onSwipeLeft={onSwipeLeft} />)

        // Too short.
        swipe(container.firstElementChild!, 200, 180)
        // Vertical-dominant scroll.
        swipe(container.firstElementChild!, 200, 120, 100, 200)

        expect(onSwipeLeft).not.toHaveBeenCalled()
    })

    it('ignores touches that start inside the ignore selector', () => {
        const onSwipeLeft = vi.fn()
        const { container } = render(
            <SwipeProbe onSwipeLeft={onSwipeLeft} ignoreSelector="[data-stationary]">
                <div data-stationary="true" data-testid="inner" />
            </SwipeProbe>
        )

        swipe(screen.getByTestId('inner')!, 300, 200)

        expect(onSwipeLeft).not.toHaveBeenCalled()
    })

    it('ignores touches that start inside a natively horizontal scroller', () => {
        const onSwipeLeft = vi.fn()
        const { container } = render(
            <SwipeProbe onSwipeLeft={onSwipeLeft}>
                <div data-testid="scroller" />
            </SwipeProbe>
        )
        const scroller = screen.getByTestId('scroller')!
        Object.defineProperty(scroller, 'scrollWidth', { value: 500, configurable: true })
        Object.defineProperty(scroller, 'clientWidth', { value: 200, configurable: true })
        vi.spyOn(window, 'getComputedStyle').mockReturnValue({ overflowX: 'auto' } as CSSStyleDeclaration)

        swipe(scroller, 300, 200)

        expect(onSwipeLeft).not.toHaveBeenCalled()
    })

    it('stops tracking after touch cancellation', () => {
        const onSwipeLeft = vi.fn()
        const { container } = render(<SwipeProbe onSwipeLeft={onSwipeLeft} />)
        const el = container.firstElementChild!

        fireTouch(el, 'touchstart', { clientX: 300, clientY: 100 })
        fireTouch(el, 'touchcancel', { clientX: 300, clientY: 100 })
        fireTouch(el, 'touchend', { clientX: 200, clientY: 100 })

        expect(onSwipeLeft).not.toHaveBeenCalled()
    })
})
