import { describe, expect, it } from 'vitest'
import { buildDifitArgs, isExpectedExternalReviewAdoption } from './difit'

const localRegistration = {
    id: '0123456789abcdef01234567',
    repositoryPath: '/repo',
    branch: 'feature/review',
    baseRef: 'develop',
    targetRef: '.',
    pid: 123,
    hapiSessionId: 'session-1'
}

describe('DIFIT management arguments', () => {
    it('starts a live review with untracked files in the background', () => {
        expect(buildDifitArgs()).toEqual(['.', '--include-untracked', '--background'])
    })

    it('preserves the base and GitLab MR when restarting a live review', () => {
        expect(buildDifitArgs({
            ...localRegistration,
            reviewUrl: 'https://gitlab.example.test/group/project/-/merge_requests/1',
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

describe('DIFIT review identity transitions', () => {
    it('accepts a rekey when the same local review adopts a GitLab MR', () => {
        expect(isExpectedExternalReviewAdoption(localRegistration, {
            ...localRegistration,
            id: '89abcdef0123456701234567',
            reviewUrl: 'https://gitlab.example.test/group/project/-/merge_requests/1',
            pid: 456
        })).toBe(true)
    })

    it.each([
        ['repository', { repositoryPath: '/other-repo' }],
        ['branch', { branch: 'other-branch' }],
        ['base', { baseRef: 'main' }],
        ['target', { targetRef: 'HEAD' }],
    ])('rejects adoption by a review with a different %s', (_label, changed) => {
        expect(isExpectedExternalReviewAdoption(localRegistration, {
            ...localRegistration,
            ...changed,
            id: '89abcdef0123456701234567',
            reviewUrl: 'https://gitlab.example.test/group/project/-/merge_requests/1',
            pid: 456
        })).toBe(false)
    })

    it('rejects an identity change when the previous review was already external', () => {
        expect(isExpectedExternalReviewAdoption({
            ...localRegistration,
            reviewUrl: 'https://gitlab.example.test/group/project/-/merge_requests/1'
        }, {
            ...localRegistration,
            id: '89abcdef0123456701234567',
            reviewUrl: 'https://gitlab.example.test/group/project/-/merge_requests/2',
            pid: 456
        })).toBe(false)
    })
})
