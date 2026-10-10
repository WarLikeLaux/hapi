import { Fragment, useLayoutEffect, useRef } from 'react'
import { parseExternalMessageSegments } from '@/chat/externalMessageLinks'
import type { ExternalMessage } from '@hapi/protocol/messengers'

export function ExternalMessageText(props: { text: string; textLinks?: ExternalMessage['textLinks']; compact?: boolean }) {
    const ref = useRef<HTMLDivElement>(null)

    useLayoutEffect(() => {
        const element = ref.current
        if (!element || !props.compact || typeof ResizeObserver === 'undefined') return

        // fit-content keeps the available width after wrapping. Measure the
        // rendered inline fragments so the bubble can shed that unused space
        // without changing the line breaks or reserving less room for its time.
        const measure = () => {
            element.style.width = ''
            const box = element.getBoundingClientRect()
            if (box.width === 0) return
            const range = document.createRange()
            let right = box.left
            const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
            let node: Node | null
            while ((node = walker.nextNode())) {
                // pre-wrap can hang a breaking space outside the line box.
                // Keep spaces in the DOM, but size to the visible words.
                for (const word of (node.textContent ?? '').matchAll(/\S+/g)) {
                    range.setStart(node, word.index)
                    range.setEnd(node, word.index + word[0].length)
                    for (const rect of range.getClientRects()) right = Math.max(right, rect.right)
                }
            }
            const width = Math.ceil(right - box.left)
            if (width > 0 && width < box.width) element.style.width = `${width}px`
        }

        measure()
        let frame = 0
        const schedule = () => {
            cancelAnimationFrame(frame)
            frame = requestAnimationFrame(measure)
        }
        const observer = new ResizeObserver(schedule)
        observer.observe(element)
        // The text's explicit width cannot reveal a wider available space by
        // itself. Watch the full message row too (viewport/sidebar resizing).
        const row = element.closest('[data-provider-message-id]')
        if (row) observer.observe(row)
        document.fonts?.addEventListener('loadingdone', schedule)

        return () => {
            observer.disconnect()
            cancelAnimationFrame(frame)
            document.fonts?.removeEventListener('loadingdone', schedule)
            element.style.width = ''
        }
    }, [props.text, props.textLinks, props.compact])

    const segments = parseExternalMessageSegments(props.text, props.textLinks)
    return (
        <div ref={ref} className="max-w-full whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
            {segments.map((segment, index) => segment.type === 'text' ? (
                <Fragment key={index}>{segment.text}</Fragment>
            ) : (
                <a
                    key={index}
                    href={segment.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[var(--app-link)] underline decoration-[color:var(--app-link-muted)] underline-offset-3"
                >
                    {segment.text}
                </a>
            ))}
        </div>
    )
}
