import { useCallback, useEffect } from 'react'
import type { FocusEventHandler, RefObject } from 'react'

export function useChatKeyboardTail(options: {
    viewportRef: RefObject<HTMLDivElement | null>
    composerRef: RefObject<HTMLTextAreaElement | null>
    stickToBottomRef: RefObject<boolean>
    /** False while the pane shows its loading placeholder: the viewport is not
     * mounted yet, so the resize observer must attach once it appears. */
    active?: boolean
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
        if (options.active === false) return
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
    }, [options.active, options.composerRef, options.stickToBottomRef, options.viewportRef, scrollToBottom])

    return handleComposerFocus
}
