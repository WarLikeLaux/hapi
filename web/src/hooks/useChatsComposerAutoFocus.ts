import { useEffect, type RefObject } from 'react'

type Options = {
    composerRef: RefObject<HTMLTextAreaElement | null>
    /** Insert the captured character into the composer text. */
    onInsertCharacter?: (character: string) => void
    /** Defaults to true. Lets callers disable the listener without unmounting. */
    enabled?: boolean
}

/**
 * True when `key` is a single printable character. Space and visible
 * glyphs qualify; Tab, Enter, Esc, arrows, function keys, and any
 * modifier combo don't.
 *
 * Single-character keys that are still control glyphs (e.g. the Backspace
 * on some layouts emits `'\b'`) are filtered by the codepoint range so
 * the composer never receives them as "typed" text.
 */
export function isChatsAutoFocusPrintableKey(key: string): boolean {
    if (key.length !== 1) return false
    const code = key.charCodeAt(0)
    return code >= 0x20 && code !== 0x7F
}

/**
 * True when a global "type-to-focus" shortcut should be SKIPPED for the
 * given event target. Window-level focus theft must not pull focus out
 * of:
 *   - any descendant of an open dialog (Radix DialogContent renders
 *     role="dialog"; this matches Klipy picker / rename / etc.)
 *   - HTMLInputElement, HTMLSelectElement, HTMLTextAreaElement (we are
 *     already typing — let the original target keep the keystroke)
 *   - contentEditable hosts (rich composers elsewhere in the app)
 *
 * Pure / exported for unit tests.
 */
export function isChatsAutoFocusBlockedTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false
    if (target.closest('[role="dialog"]') !== null) return true
    if (target instanceof HTMLInputElement) return true
    if (target instanceof HTMLSelectElement) return true
    if (target instanceof HTMLTextAreaElement) return true
    if (target.isContentEditable === true) return true
    return target.getAttribute('contenteditable') === 'true'
}

/**
 * Type-anywhere → focus the chats composer. Mirrors Discord/Slack so the
 * user never has to mouse over to the textarea while reading the
 * thread. The captured character is forwarded to `onInsertCharacter` so
 * the caller can append it to the existing draft instead of dropping the
 * user's first keystroke (which is the whole point of the shortcut).
 *
 * Skipped for modifier combos (hotkeys), IME composition (Russian /
 * CJK input), auto-repeat, and any focus target listed by
 * {@link isChatsAutoFocusBlockedTarget}. Pure — the listener is the
 * only side effect and it cleans up on unmount.
 */
export function useChatsComposerAutoFocus(options: Options): void {
    const { composerRef, onInsertCharacter, enabled = true } = options

    useEffect(() => {
        if (!enabled) return
        const composer = composerRef.current

        const handler = (event: KeyboardEvent) => {
            if (event.defaultPrevented || event.repeat || event.isComposing) return
            if (event.ctrlKey || event.metaKey || event.altKey) return
            if (!isChatsAutoFocusPrintableKey(event.key)) return
            if (isChatsAutoFocusBlockedTarget(event.target)) return
            const target = composerRef.current ?? composer
            if (!target) return
            event.preventDefault()
            target.focus({ preventScroll: true })
            onInsertCharacter?.(event.key)
        }

        window.addEventListener('keydown', handler)
        return () => window.removeEventListener('keydown', handler)
    }, [composerRef, onInsertCharacter, enabled])
}