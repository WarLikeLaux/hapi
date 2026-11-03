import { useEffect } from 'react'

/** Let the focused control and open overlays handle Escape before leaving the chat. */
export function useCloseChatOnEscape(enabled: boolean, onClose: () => void, desktopOnly = true) {
    useEffect(() => {
        if (!enabled) return
        let overlayWasOpen = false
        const capture = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return
            overlayWasOpen = Boolean(document.querySelector('[role="dialog"], [role="menu"], [role="listbox"], [data-state="open"][data-radix-popper-content-wrapper]'))
        }
        const handle = (event: KeyboardEvent) => {
            if (event.key !== 'Escape' || event.isComposing || event.repeat || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
            if ((desktopOnly && !window.matchMedia('(min-width: 920px)').matches) || overlayWasOpen) return
            const target = event.target
            if (target instanceof HTMLElement && (target.tagName === 'INPUT' || target.tagName === 'SELECT')) return
            // Window listeners for composer controls may run after this listener.
            queueMicrotask(() => { if (!event.defaultPrevented) onClose() })
        }
        document.addEventListener('keydown', capture, true)
        window.addEventListener('keydown', handle)
        return () => {
            document.removeEventListener('keydown', capture, true)
            window.removeEventListener('keydown', handle)
        }
    }, [enabled, onClose, desktopOnly])
}
