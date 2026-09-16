import { useCallback, useEffect } from 'react'
import type { FocusEventHandler, RefObject } from 'react'

export function useChatKeyboardTail(options: {
    viewportRef: RefObject<HTMLDivElement | null>
    composerRef: RefObject<HTMLTextAreaElement | null>
    stickToBottomRef: RefObject<boolean>
}): FocusEventHandler<HTMLTextAreaElement> {
    const scrollToBottom = useCallback(() => {
        const viewport = options.viewportRef.current
        if (viewport) viewport.scrollTop = viewport.scrollHeight
    }, [options.viewportRef])

    const handleComposerFocus = useCallback<FocusEventHandler<HTMLTextAreaElement>>(() => {
        options.stickToBottomRef.current = true
        scrollToBottom()
        requestAnimationFrame(scrollToBottom)
    }, [options.stickToBottomRef, scrollToBottom])

    useEffect(() => {
        const viewport = options.viewportRef.current
        if (!viewport || typeof ResizeObserver === 'undefined') return

        const observer = new ResizeObserver(() => {
            const composerFocused = document.activeElement === options.composerRef.current
            if (!options.stickToBottomRef.current && !composerFocused) return
            options.stickToBottomRef.current = true
            requestAnimationFrame(scrollToBottom)
        })
        observer.observe(viewport)
        return () => observer.disconnect()
    }, [options.composerRef, options.stickToBottomRef, options.viewportRef, scrollToBottom])

    return handleComposerFocus
}
