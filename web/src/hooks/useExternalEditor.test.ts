import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import {
    getInitialExternalEditorBaseUrl,
    normalizeExternalEditorBaseUrl,
    useExternalEditorBaseUrl,
} from './useExternalEditor'

const STORAGE_KEY = 'hapi-external-editor-base-url'

describe('normalizeExternalEditorBaseUrl', () => {
    it.each([
        ['', null],
        ['   ', null],
        ['not a url', null],
        ['ftp://code.local', null],
        ['javascript:alert(1)', null],
        ['file:///etc/passwd', null],
    ])('rejects %j', (raw, expected) => {
        expect(normalizeExternalEditorBaseUrl(raw)).toBe(expected)
    })

    it.each([
        ['https://code.local', 'https://code.local'],
        ['https://code.local/', 'https://code.local'],
        ['https://code.local///', 'https://code.local'],
        ['http://127.0.0.1:8081', 'http://127.0.0.1:8081'],
        ['https://code.local/subpath/', 'https://code.local/subpath'],
    ])('normalizes %j', (raw, expected) => {
        expect(normalizeExternalEditorBaseUrl(raw)).toBe(expected)
    })
})

describe('useExternalEditorBaseUrl', () => {
    beforeEach(() => {
        window.localStorage.clear()
    })

    it('defaults to disabled', () => {
        expect(getInitialExternalEditorBaseUrl()).toBe('')
        const { result } = renderHook(() => useExternalEditorBaseUrl())
        expect(result.current.externalEditorBaseUrl).toBe('')
    })

    it('persists the normalized URL and syncs hook instances in the same tab', () => {
        const first = renderHook(() => useExternalEditorBaseUrl())
        const second = renderHook(() => useExternalEditorBaseUrl())

        act(() => first.result.current.setExternalEditorBaseUrl('https://code.local/'))
        expect(first.result.current.externalEditorBaseUrl).toBe('https://code.local')
        expect(second.result.current.externalEditorBaseUrl).toBe('https://code.local')
        expect(window.localStorage.getItem(STORAGE_KEY)).toBe('https://code.local')

        act(() => second.result.current.setExternalEditorBaseUrl('garbage'))
        expect(first.result.current.externalEditorBaseUrl).toBe('')
        expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull()
    })

    it('synchronizes changes from another browsing context', () => {
        const { result } = renderHook(() => useExternalEditorBaseUrl())
        act(() => {
            window.dispatchEvent(new StorageEvent('storage', {
                key: STORAGE_KEY,
                newValue: 'https://code.local',
            }))
        })
        expect(result.current.externalEditorBaseUrl).toBe('https://code.local')
    })
})
