import { afterEach, describe, expect, it } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useRef } from 'react'
import { useChatsComposerAutoFocus } from './useChatsComposerAutoFocus'

describe('type to focus the composer', () => {
    afterEach(() => {
        document.getSelection()?.removeAllRanges()
        document.body.replaceChildren()
    })

    function setup() {
        const composer = document.createElement('textarea')
        document.body.append(composer)
        renderHook(() => {
            const ref = useRef(composer)
            useChatsComposerAutoFocus({ composerRef: ref })
        })
        return composer
    }

    function key(target: HTMLElement, init: KeyboardEventInit = {}) {
        const event = new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true, ...init })
        target.dispatchEvent(event)
        return event
    }

    it('focuses the composer without cancelling the native character input', () => {
        const composer = setup()
        const event = key(document.body)
        expect(document.activeElement).toBe(composer)
        expect(event.defaultPrevented).toBe(false)
    })

    it('leaves shortcuts, composition and keyboard navigation alone', () => {
        const composer = setup()
        for (const init of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { isComposing: true }, { key: 'Process' }, { key: 'Tab' }, { key: ' ' }]) {
            expect(key(document.body, init).defaultPrevented).toBe(false)
            expect(document.activeElement).not.toBe(composer)
        }
    })

    it('does not steal input from interactive controls, menus or dialogs', () => {
        const composer = setup()
        for (const html of ['<button>Button</button>', '<a href="#">Link</a>', '<input>', '<div contenteditable="plaintext-only"><span>Text</span></div>', '<div role="menu"><div role="menuitem">Item</div></div>', '<div role="dialog">Dialog</div>']) {
            const container = document.createElement('div')
            container.innerHTML = html
            document.body.append(container)
            const target = container.querySelector('span, [role="menuitem"]') ?? container.firstElementChild!
            key(target as HTMLElement)
            expect(document.activeElement).not.toBe(composer)
            container.remove()
        }
    })

    it('preserves selected text and ignores typing while an overlay is open', () => {
        const composer = setup()
        const text = document.createElement('p')
        text.textContent = 'Selected text'
        document.body.append(text)
        const range = document.createRange()
        range.selectNodeContents(text)
        document.getSelection()!.addRange(range)
        key(document.body)
        expect(document.activeElement).not.toBe(composer)
        document.getSelection()!.removeAllRanges()
        const dialog = document.createElement('div')
        dialog.setAttribute('role', 'dialog')
        document.body.append(dialog)
        key(document.body)
        expect(document.activeElement).not.toBe(composer)
    })
})
