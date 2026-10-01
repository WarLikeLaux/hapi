import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useRef } from 'react'
import {
    isChatsAutoFocusBlockedTarget,
    isChatsAutoFocusPrintableKey,
    useChatsComposerAutoFocus,
} from './useChatsComposerAutoFocus'

function fireKey(target: EventTarget | null, init: Partial<KeyboardEvent>): boolean {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
    if (target) {
        Object.defineProperty(event, 'target', { configurable: true, value: target })
    }
    const dispatched = target?.dispatchEvent(event) ?? window.dispatchEvent(event)
    return event.defaultPrevented
}

function setupHook(options?: { onInsertCharacter?: (char: string) => void; enabled?: boolean }) {
    return renderHook(() => {
        const ref = useRef<HTMLTextAreaElement | null>(null)
        useChatsComposerAutoFocus({
            composerRef: ref,
            onInsertCharacter: options?.onInsertCharacter,
            enabled: options?.enabled,
        })
        return { ref, attach: (element: HTMLTextAreaElement) => { ref.current = element } }
    })
}

describe('isChatsAutoFocusPrintableKey', () => {
    it('accepts plain letters, digits and space', () => {
        for (const key of ['a', 'Z', '0', ' ', 'Я', '诶']) {
            expect(isChatsAutoFocusPrintableKey(key)).toBe(true)
        }
    })

    it('rejects control keys, function keys, and modifier labels', () => {
        for (const key of ['Enter', 'Tab', 'Escape', 'Backspace', 'Delete', 'ArrowUp', 'F5', 'Shift', 'Meta']) {
            expect(isChatsAutoFocusPrintableKey(key)).toBe(false)
        }
    })
})

describe('isChatsAutoFocusBlockedTarget', () => {
    it('blocks HTMLInputElement and HTMLTextAreaElement', () => {
        const input = document.createElement('input')
        const textarea = document.createElement('textarea')
        document.body.append(input, textarea)
        try {
            expect(isChatsAutoFocusBlockedTarget(input)).toBe(true)
            expect(isChatsAutoFocusBlockedTarget(textarea)).toBe(true)
        } finally {
            input.remove()
            textarea.remove()
        }
    })

    it('blocks contentEditable hosts (both attribute and property)', () => {
        const rich = document.createElement('div')
        rich.setAttribute('contenteditable', 'true')
        document.body.append(rich)
        try {
            expect(isChatsAutoFocusBlockedTarget(rich)).toBe(true)
        } finally {
            rich.remove()
        }
    })

    it('blocks descendants of an open dialog', () => {
        const dialog = document.createElement('div')
        dialog.setAttribute('role', 'dialog')
        const inner = document.createElement('button')
        dialog.append(inner)
        document.body.append(dialog)
        try {
            expect(isChatsAutoFocusBlockedTarget(inner)).toBe(true)
            expect(isChatsAutoFocusBlockedTarget(dialog)).toBe(true)
        } finally {
            dialog.remove()
        }
    })

    it('does not block the body or a plain element', () => {
        const div = document.createElement('div')
        document.body.append(div)
        try {
            expect(isChatsAutoFocusBlockedTarget(div)).toBe(false)
            expect(isChatsAutoFocusBlockedTarget(document.body)).toBe(false)
        } finally {
            div.remove()
        }
    })

    it('returns false for non-HTMLEventTarget values', () => {
        expect(isChatsAutoFocusBlockedTarget(null)).toBe(false)
        expect(isChatsAutoFocusBlockedTarget({} as EventTarget)).toBe(false)
    })
})

describe('useChatsComposerAutoFocus', () => {
    let composer: HTMLTextAreaElement

    beforeEach(() => {
        composer = document.createElement('textarea')
        composer.tabIndex = 0
        document.body.append(composer)
    })

    afterEach(() => {
        composer.remove()
    })

    it('focuses the composer and forwards the captured character', () => {
        const onInsert = vi.fn()
        const { result } = setupHook({ onInsertCharacter: onInsert })
        act(() => result.current.attach(composer))

        const handled = fireKey(document.body, { key: 'h' })

        expect(handled).toBe(true)
        expect(document.activeElement).toBe(composer)
        expect(onInsert).toHaveBeenCalledWith('h')
    })

    it('ignores modifier combos so global shortcuts keep working', () => {
        const onInsert = vi.fn()
        const { result } = setupHook({ onInsertCharacter: onInsert })
        act(() => result.current.attach(composer))

        expect(fireKey(document.body, { key: 'k', ctrlKey: true })).toBe(false)
        expect(fireKey(document.body, { key: 'k', metaKey: true })).toBe(false)
        expect(fireKey(document.body, { key: 'k', altKey: true })).toBe(false)
        expect(onInsert).not.toHaveBeenCalled()
        expect(document.activeElement).not.toBe(composer)
    })

    it('ignores non-printable keys (Enter, Tab, Escape, arrows, F-keys)', () => {
        const onInsert = vi.fn()
        const { result } = setupHook({ onInsertCharacter: onInsert })
        act(() => result.current.attach(composer))

        for (const key of ['Enter', 'Tab', 'Escape', 'ArrowDown', 'F5']) {
            expect(fireKey(document.body, { key })).toBe(false)
        }
        expect(onInsert).not.toHaveBeenCalled()
    })

    it('ignores auto-repeat so a held key does not paste the same char repeatedly', () => {
        const onInsert = vi.fn()
        const { result } = setupHook({ onInsertCharacter: onInsert })
        act(() => result.current.attach(composer))

        expect(fireKey(document.body, { key: 'a', repeat: true })).toBe(false)
        expect(onInsert).not.toHaveBeenCalled()
    })

    it('ignores IME composition events', () => {
        const onInsert = vi.fn()
        const { result } = setupHook({ onInsertCharacter: onInsert })
        act(() => result.current.attach(composer))

        const event = new KeyboardEvent('keydown', { key: 'п', bubbles: true, cancelable: true })
        Object.defineProperty(event, 'isComposing', { value: true })
        window.dispatchEvent(event)

        expect(event.defaultPrevented).toBe(false)
        expect(onInsert).not.toHaveBeenCalled()
    })

    it('does not steal keystrokes from inputs, textareas, or contentEditable', () => {
        const onInsert = vi.fn()
        const { result } = setupHook({ onInsertCharacter: onInsert })
        act(() => result.current.attach(composer))

        const input = document.createElement('input')
        document.body.append(input)
        const textarea = document.createElement('textarea')
        document.body.append(textarea)
        const rich = document.createElement('div')
        rich.setAttribute('contenteditable', 'true')
        document.body.append(rich)

        try {
            expect(fireKey(input, { key: 'a' })).toBe(false)
            expect(fireKey(textarea, { key: 'a' })).toBe(false)
            expect(fireKey(rich, { key: 'a' })).toBe(false)
        } finally {
            input.remove()
            textarea.remove()
            rich.remove()
        }
        expect(onInsert).not.toHaveBeenCalled()
        expect(document.activeElement).not.toBe(composer)
    })

    it('does not pull focus out of an open dialog', () => {
        const onInsert = vi.fn()
        const { result } = setupHook({ onInsertCharacter: onInsert })
        act(() => result.current.attach(composer))

        const dialog = document.createElement('div')
        dialog.setAttribute('role', 'dialog')
        const inner = document.createElement('button')
        dialog.append(inner)
        document.body.append(dialog)
        try {
            expect(fireKey(inner, { key: 'q' })).toBe(false)
        } finally {
            dialog.remove()
        }
        expect(onInsert).not.toHaveBeenCalled()
    })

    it('does nothing when disabled', () => {
        const onInsert = vi.fn()
        const { result } = setupHook({ onInsertCharacter: onInsert, enabled: false })
        act(() => result.current.attach(composer))

        expect(fireKey(document.body, { key: 'h' })).toBe(false)
        expect(onInsert).not.toHaveBeenCalled()
    })

    it('removes the listener on unmount', () => {
        const onInsert = vi.fn()
        const { result, unmount } = setupHook({ onInsertCharacter: onInsert })
        act(() => result.current.attach(composer))
        unmount()

        expect(fireKey(document.body, { key: 'h' })).toBe(false)
        expect(onInsert).not.toHaveBeenCalled()
    })
})