import { describe, expect, it } from 'vitest'
import { readDisplayGitBranch } from './useSessionGitBranch'

describe('readDisplayGitBranch', () => {
    it('reads the current branch from porcelain v2 status', () => {
        expect(readDisplayGitBranch('# branch.oid abcdef123456\n# branch.head feature/header\n')).toBe('feature/header')
    })

    it('keeps detached HEAD visible with a short commit id', () => {
        expect(readDisplayGitBranch('# branch.oid abcdef123456\n# branch.head (detached)\n')).toBe('detached@abcdef1')
    })

    it('returns null outside a Git worktree', () => {
        expect(readDisplayGitBranch('')).toBeNull()
    })
})
