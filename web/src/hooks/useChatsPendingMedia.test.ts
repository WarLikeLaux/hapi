import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useChatsPendingMedia } from './useChatsPendingMedia'

function makeFile(name: string, type: string): File {
    return new File([new Uint8Array([1, 2, 3])], name, { type })
}

function makeClipboardEvent(file: File | null): React.ClipboardEvent<HTMLElement> {
    type ClipboardItem = { kind: string; type: string; getAsFile: () => File | null }
    const items: ClipboardItem[] = file
        ? [{ kind: 'file', type: file.type, getAsFile: () => file }]
        : []
    const data = {
        items: {
            length: items.length,
            [Symbol.iterator]: function* () { for (const item of items) yield item },
        },
    }
    const event = {
        clipboardData: data,
        preventDefault: vi.fn(),
    }
    return event as unknown as React.ClipboardEvent<HTMLElement>
}

describe('useChatsPendingMedia', () => {
    let revokeSpy: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
        revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
        vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:test/${Math.random()}`)
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    it('stages an image on paste and exposes a blob preview URL', () => {
        const file = makeFile('cat.png', 'image/png')
        const { result } = renderHook(() => useChatsPendingMedia())

        let consumed: boolean | undefined
        act(() => {
            consumed = result.current.handlePaste(makeClipboardEvent(file))
        })

        expect(consumed).toBe(true)
        expect(result.current.pendingMedia).toBe(file)
        expect(result.current.previewUrl).toMatch(/^blob:/)
    })

    it('passes through a paste without an image', () => {
        const { result } = renderHook(() => useChatsPendingMedia())
        const event = makeClipboardEvent(null)

        let consumed: boolean | undefined
        act(() => {
            consumed = result.current.handlePaste(event)
        })

        expect(consumed).toBe(false)
        expect(result.current.pendingMedia).toBeNull()
        expect(result.current.previewUrl).toBeNull()
        expect(event.preventDefault).not.toHaveBeenCalled()
    })

    it('replaces the staged file (and revokes the previous preview URL)', () => {
        const first = makeFile('a.png', 'image/png')
        const second = makeFile('b.png', 'image/png')
        const { result } = renderHook(() => useChatsPendingMedia())

        act(() => result.current.handlePaste(makeClipboardEvent(first)))
        const previousUrl = result.current.previewUrl
        expect(previousUrl).toBeTruthy()

        act(() => result.current.handlePaste(makeClipboardEvent(second)))
        expect(result.current.pendingMedia).toBe(second)
        expect(result.current.previewUrl).not.toBe(previousUrl)
        expect(revokeSpy).toHaveBeenCalledWith(previousUrl)
    })

    it('clears the staged file via clearPendingMedia', () => {
        const file = makeFile('cat.png', 'image/png')
        const { result } = renderHook(() => useChatsPendingMedia())
        act(() => result.current.handlePaste(makeClipboardEvent(file)))
        const previousUrl = result.current.previewUrl

        act(() => result.current.clearPendingMedia())

        expect(result.current.pendingMedia).toBeNull()
        expect(result.current.previewUrl).toBeNull()
        expect(revokeSpy).toHaveBeenCalledWith(previousUrl)
    })

    it('revokes the preview URL on unmount', () => {
        const file = makeFile('cat.png', 'image/png')
        const { result, unmount } = renderHook(() => useChatsPendingMedia())
        act(() => result.current.handlePaste(makeClipboardEvent(file)))
        const url = result.current.previewUrl
        expect(url).toBeTruthy()

        unmount()
        expect(revokeSpy).toHaveBeenCalledWith(url)
    })
})