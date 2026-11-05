import { useEffect, type RefObject } from 'react'

type Options = {
    composerRef?: RefObject<HTMLTextAreaElement | null>
    focusComposer?: () => void
    enabled?: boolean
}

// Leave keyboard interaction with controls, editors and composite widgets to
// those elements. Focusable message viewports are typing surfaces, not controls.
// In particular, Space must retain its native button/scroll use.
const interactive = 'input, textarea, select, button, a[href], summary, [contenteditable]:not([contenteditable="false"]), [tabindex]:not([tabindex="-1"]):not([data-composer-typing-surface]), [role="button"], [role="link"], [role="menu"], [role="menuitem"], [role="listbox"], [role="option"], [role="dialog"], [role="alertdialog"], [role="tree"], [role="grid"], [role="tablist"], [role="slider"]'
const overlays = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [data-state="open"][data-radix-popper-content-wrapper]'

/** Focus the active composer for ordinary typing, leaving insertion to the browser. */
export function useChatsComposerAutoFocus({ composerRef, focusComposer, enabled = true }: Options): void {
    useEffect(() => {
        if (!enabled) return
        const handler = (event: KeyboardEvent) => {
            if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return
            if (event.ctrlKey || event.metaKey || event.altKey) return
            if (Array.from(event.key).length !== 1 || event.key.trim() === '' || /[\x00-\x1f\x7f]/.test(event.key)) return
            if (event.target instanceof Element && event.target.closest(interactive)) return
            if (document.querySelector(overlays)) return
            const selection = document.getSelection()
            if (selection && !selection.isCollapsed) return
            if (focusComposer) focusComposer()
            else {
                const target = composerRef?.current
                if (!target || target.disabled || target.readOnly) return
                target.focus({ preventScroll: true })
            }
        }
        window.addEventListener('keydown', handler)
        return () => window.removeEventListener('keydown', handler)
    }, [composerRef, focusComposer, enabled])
}
