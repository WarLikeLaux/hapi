import { beforeEach, describe, expect, it } from 'vitest'
import {
    clearIndeterminateMessageDismissal,
    isIndeterminateMessageDismissed,
    persistIndeterminateMessageDismissal,
} from './queued-message-dismissals'

describe('queued message dismissals', () => {
    beforeEach(() => window.localStorage.clear())

    it('persists an indeterminate dismissal across module consumers', () => {
        persistIndeterminateMessageDismissal('session-1', 'local-1')

        expect(isIndeterminateMessageDismissed('session-1', 'local-1')).toBe(true)
        expect(isIndeterminateMessageDismissed('session-2', 'local-1')).toBe(false)
    })

    it('clears a dismissal when the message is safely requeued', () => {
        persistIndeterminateMessageDismissal('session-1', 'local-1')
        clearIndeterminateMessageDismissal('session-1', 'local-1')

        expect(isIndeterminateMessageDismissed('session-1', 'local-1')).toBe(false)
    })

    it('ignores malformed stored data', () => {
        window.localStorage.setItem('hapi.dismissedIndeterminateMessages.v1', '{broken')

        expect(isIndeterminateMessageDismissed('session-1', 'local-1')).toBe(false)
    })
})
