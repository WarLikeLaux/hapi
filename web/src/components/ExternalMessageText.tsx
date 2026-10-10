import { Fragment, useLayoutEffect, useRef, type ReactNode } from 'react'
import { parseExternalMessageSegments } from '@/chat/externalMessageLinks'
import type { ExternalMessage } from '@hapi/protocol/messengers'

export function ExternalMessageText(props: { text: string; textLinks?: ExternalMessage['textLinks']; compact?: boolean; footer?: ReactNode }) {
    const ref = useRef<HTMLDivElement>(null)
    const textRef = useRef<HTMLSpanElement>(null)
    const footerRef = useRef<HTMLSpanElement>(null)
    const spacerRef = useRef<HTMLSpanElement>(null)

    useLayoutEffect(() => {
        const element = ref.current
        const text = textRef.current
        if (!element || !text) return

        // fit-content keeps the available width after wrapping. Measure the
        // rendered inline fragments, including the final-line time spacer,
        // so the bubble can shed unused space without changing line breaks.
        const measure = () => {
            if (spacerRef.current && footerRef.current) {
                spacerRef.current.style.width = `${Math.ceil(footerRef.current.getBoundingClientRect().width) + 8}px`
            }
            if (!props.compact) return
            element.style.width = ''
            const box = element.getBoundingClientRect()
            if (box.width === 0) return
            const range = document.createRange()
            let right = box.left
            const walker = document.createTreeWalker(text, NodeFilter.SHOW_TEXT)
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
            if (spacerRef.current) right = Math.max(right, spacerRef.current.getBoundingClientRect().right)
            const width = Math.ceil(right - box.left)
            if (width > 0 && width < box.width) element.style.width = `${width}px`
        }

        measure()
        if (typeof ResizeObserver === 'undefined') return
        let frame = 0
        const schedule = () => {
            cancelAnimationFrame(frame)
            frame = requestAnimationFrame(measure)
        }
        const observer = new ResizeObserver(schedule)
        observer.observe(element)
        if (footerRef.current) observer.observe(footerRef.current)
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
    }, [props.text, props.textLinks, props.compact, props.footer])

    const segments = parseExternalMessageSegments(props.text, props.textLinks)
    return (
        <div ref={ref} className="relative max-w-full whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
            <span ref={textRef}>
                {segments.map((segment, index) => segment.type === 'text' ? (
                    <Fragment key={index}>{segment.text}</Fragment>
                ) : (
                    <a
                        key={index}
                        href={segment.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[var(--app-link)] no-underline"
                    >
                        {segment.text}
                    </a>
                ))}
            </span>
            {props.footer ? <>
                <span ref={spacerRef} aria-hidden="true" className="inline-block" />
                <span ref={footerRef} className="absolute bottom-0 right-0 w-max whitespace-nowrap">{props.footer}</span>
            </> : null}
        </div>
    )
}
