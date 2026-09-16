import { act, fireEvent, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatKeyboardTail } from './useChatKeyboardTail'

describe('useChatKeyboardTail', () => {
    let resizeCallback: ResizeObserverCallback

    beforeEach(() => {
        vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
            callback(0)
            return 1
        })
        vi.stubGlobal('ResizeObserver', class {
            constructor(callback: ResizeObserverCallback) {
                resizeCallback = callback
            }
            observe() {}
            disconnect() {}
        })
    })

    afterEach(() => vi.unstubAllGlobals())

    function Harness() {
        const viewportRef = useRef<HTMLDivElement>(null)
        const composerRef = useRef<HTMLTextAreaElement>(null)
        const stickToBottomRef = useRef(false)
        const onFocus = useChatKeyboardTail({ viewportRef, composerRef, stickToBottomRef })
        return (
            <>
                <div ref={viewportRef} data-testid="viewport" />
                <textarea ref={composerRef} aria-label="Message" onFocus={onFocus} />
            </>
        )
    }

    it('keeps the newest message visible while the keyboard shrinks the chat viewport', () => {
        render(<Harness />)
        const viewport = screen.getByTestId('viewport')
        Object.defineProperty(viewport, 'scrollHeight', { configurable: true, value: 1_200 })

        fireEvent.focus(screen.getByRole('textbox', { name: 'Message' }))
        expect(viewport.scrollTop).toBe(1_200)

        Object.defineProperty(viewport, 'scrollHeight', { configurable: true, value: 1_260 })
        act(() => resizeCallback([], {} as ResizeObserver))
        expect(viewport.scrollTop).toBe(1_260)
    })
})
