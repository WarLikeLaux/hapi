import { describe, expect, it } from 'vitest'
import { parseDifitReviewArgs } from './difitReview'

describe('difit-review command arguments', () => {
    it('parses an attachment without interpreting branch characters', () => {
        expect(parseDifitReviewArgs([
            'attach',
            '--review-id', 'review-1',
            '--url', 'https://difit.local/reviews/review-1/',
            '--review-url', 'https://gitlab.example.test/group/project/-/merge_requests/1',
            '--branch', 'feature/review'
        ])).toEqual({
            help: false,
            action: 'attach',
            reviewId: 'review-1',
            url: 'https://difit.local/reviews/review-1/',
            reviewUrl: 'https://gitlab.example.test/group/project/-/merge_requests/1',
            branch: 'feature/review'
        })
    })

    it('supports an explicit session for hub-driven detachment', () => {
        expect(parseDifitReviewArgs([
            'detach',
            '--session-id', 'session-1',
            '--review-id', 'review-1'
        ])).toEqual({
            help: false,
            action: 'detach',
            sessionId: 'session-1',
            reviewId: 'review-1'
        })
    })

    it('rejects unknown arguments', () => {
        expect(() => parseDifitReviewArgs(['attach', '--unknown', 'value'])).toThrow(
            'Unexpected argument: --unknown'
        )
    })
})
