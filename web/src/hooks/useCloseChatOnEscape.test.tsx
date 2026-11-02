import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useCloseChatOnEscape } from './useCloseChatOnEscape'

describe('closing a chat with Escape', () => {
    afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = '' })

    it('closes on desktop but leaves open overlays and handled keys alone', async () => {
        vi.stubGlobal('matchMedia', () => ({ matches: true }))
        const close = vi.fn()
        renderHook(() => useCloseChatOnEscape(true, close))
        const press = async () => {
            document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
            await Promise.resolve()
        }
        const menu = document.createElement('div')
        menu.setAttribute('role', 'menu')
        document.body.append(menu)
        await press()
        expect(close).not.toHaveBeenCalled()
        menu.remove()
        const handle = (event: KeyboardEvent) => event.preventDefault()
        window.addEventListener('keydown', handle)
        await press()
        expect(close).not.toHaveBeenCalled()
        window.removeEventListener('keydown', handle)
        await press()
        expect(close).toHaveBeenCalledTimes(1)
    })

    it('does not close on the phone layout', async () => {
        vi.stubGlobal('matchMedia', () => ({ matches: false }))
        const close = vi.fn()
        renderHook(() => useCloseChatOnEscape(true, close))
        document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
        await Promise.resolve()
        expect(close).not.toHaveBeenCalled()
    })
})
