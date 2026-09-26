import { describe, expect, it } from 'vitest'
import { selectMobileSessionHeaderSecondary } from './sessionHeaderMobileMetadata'

describe('selectMobileSessionHeaderSecondary', () => {
    it('prefers the branch over other secondary details', () => {
        expect(selectMobileSessionHeaderSecondary({ branch: true, machine: true, updatedAt: true })).toBe('branch')
        expect(selectMobileSessionHeaderSecondary({ machine: true, updatedAt: true })).toBe('machine')
    })

    it('uses the next enabled and available detail when the branch is absent', () => {
        expect(selectMobileSessionHeaderSecondary({ machine: true, lastActive: true, updatedAt: true })).toBe('machine')
        expect(selectMobileSessionHeaderSecondary({ lastActive: true, updatedAt: true })).toBe('lastActive')
        expect(selectMobileSessionHeaderSecondary({ fastMode: true, updatedAt: true, createdAt: true, worktree: true })).toBe('fastMode')
        expect(selectMobileSessionHeaderSecondary({ updatedAt: true, createdAt: true, worktree: true })).toBe('createdAt')
        expect(selectMobileSessionHeaderSecondary({ worktree: true, fastMode: true })).toBe('fastMode')
    })

    it('returns no secondary detail when none are available', () => {
        expect(selectMobileSessionHeaderSecondary({})).toBeNull()
    })
})
