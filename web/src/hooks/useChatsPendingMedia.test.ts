import { describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useChatsPendingMedia } from './useChatsPendingMedia'

function clipboardEvent(...files: File[]): React.ClipboardEvent<HTMLElement> {
    return {
        clipboardData: { items: files.map(file => ({ kind: 'file', type: file.type, getAsFile: () => file })) },
        preventDefault: vi.fn(),
    } as unknown as React.ClipboardEvent<HTMLElement>
}

describe('useChatsPendingMedia', () => {
    it('accumulates all clipboard images across pastes while ignoring non-images', () => {
        const first = new File(['1'], 'first.png', { type: 'image/png' })
        const second = new File(['2'], 'second.png', { type: 'image/png' })
        const third = new File(['3'], 'third.png', { type: 'image/png' })
        const textFile = new File(['text'], 'notes.txt', { type: 'text/plain' })
        const { result } = renderHook(() => useChatsPendingMedia())
        const event = clipboardEvent(first, textFile, second)
        act(() => { expect(result.current.handlePaste(event)).toBe(true) })
        act(() => { result.current.handlePaste(clipboardEvent(third)) })
        expect(event.preventDefault).toHaveBeenCalled()
        expect(result.current.pendingMedia).toEqual([first, second, third])
    })

    it('leaves text-only and non-image pastes to the browser', () => {
        const { result } = renderHook(() => useChatsPendingMedia())
        for (const event of [clipboardEvent(), clipboardEvent(new File(['text'], 'notes.txt', { type: 'text/plain' }))]) {
            act(() => { expect(result.current.handlePaste(event)).toBe(false) })
            expect(event.preventDefault).not.toHaveBeenCalled()
        }
        expect(result.current.pendingMedia).toEqual([])
    })
})
