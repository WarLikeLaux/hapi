import { describe, expect, it } from 'vitest'
import { readDisplayGitBranch, shouldKeepPollingGitBranch } from './useSessionGitBranch'

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

describe('shouldKeepPollingGitBranch', () => {
    it('stops polling when the session path is not a git repo', () => {
        expect(shouldKeepPollingGitBranch(true, new Error('fatal: not a git repository'))).toBe(false)
        expect(shouldKeepPollingGitBranch(true, new Error('Session path not available'))).toBe(false)
    })

    it('keeps polling active sessions on transient errors', () => {
        expect(shouldKeepPollingGitBranch(true, new Error('socket timeout'))).toBe(true)
        expect(shouldKeepPollingGitBranch(true, null)).toBe(true)
    })

    it('never polls inactive sessions', () => {
        expect(shouldKeepPollingGitBranch(false, null)).toBe(false)
        expect(shouldKeepPollingGitBranch(false, new Error('socket timeout'))).toBe(false)
    })
})
