import { describe, expect, it } from 'vitest'
import { buildDifitArgs } from './difit'

describe('DIFIT management arguments', () => {
    it('starts a live review with untracked files in the background', () => {
        expect(buildDifitArgs()).toEqual(['.', '--include-untracked', '--background'])
    })

    it('preserves the base and GitLab MR when restarting a live review', () => {
        expect(buildDifitArgs({
            id: '0123456789abcdef01234567',
            repositoryPath: '/repo',
            branch: 'feature/review',
            baseRef: 'develop',
            targetRef: '.',
            reviewUrl: 'https://gitlab.example.test/group/project/-/merge_requests/1',
            pid: 123,
            hapiSessionId: 'session-1'
        })).toEqual([
            '.',
            'develop',
            '--include-untracked',
            '--gitlab-mr',
            'https://gitlab.example.test/group/project/-/merge_requests/1',
            '--background'
        ])
    })
})
