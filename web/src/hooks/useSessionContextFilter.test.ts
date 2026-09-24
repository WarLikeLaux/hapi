import { describe, expect, it, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSessionContextFilter } from './useSessionContextFilter'

describe('useSessionContextFilter', () => {
    beforeEach(() => {
        localStorage.clear()
    })

    it('defaults to all context and empty overrides', () => {
        const { result } = renderHook(() => useSessionContextFilter())
        expect(result.current.activeContext).toBe('all')
        expect(result.current.projectOverrides).toEqual({})
    })

    it('sets active context and persists to localStorage', () => {
        const { result } = renderHook(() => useSessionContextFilter())
        act(() => {
            result.current.setActiveContext('work')
        })
        expect(result.current.activeContext).toBe('work')
        expect(localStorage.getItem('hapi-active-session-context')).toBe('work')

        act(() => {
            result.current.setActiveContext('all')
        })
        expect(result.current.activeContext).toBe('all')
        expect(localStorage.getItem('hapi-active-session-context')).toBeNull()
    })

    it('sets and removes project context overrides', () => {
        const { result } = renderHook(() => useSessionContextFilter())
        act(() => {
            result.current.setProjectContextOverride('/home/code/test', 'lab')
        })
        expect(result.current.projectOverrides['/home/code/test']).toBe('lab')

        act(() => {
            result.current.setProjectContextOverride('/home/code/test', null)
        })
        expect(result.current.projectOverrides['/home/code/test']).toBeUndefined()
    })
})
