import { describe, expect, it } from 'bun:test'
import { VisibilityTracker } from './visibilityTracker'

describe('VisibilityTracker session visibility', () => {
    it('matches only a visible chat for the same namespace and session', () => {
        const tracker = new VisibilityTracker()
        tracker.registerConnection('chat', 'default', 'visible', 'session-1')

        expect(tracker.hasVisibleSessionConnection('default', 'session-1')).toBe(true)
        expect(tracker.hasVisibleSessionConnection('default', 'session-2')).toBe(false)
        expect(tracker.hasVisibleSessionConnection('other', 'session-1')).toBe(false)
    })

    it('does not treat the visible session list as an open chat', () => {
        const tracker = new VisibilityTracker()
        tracker.registerConnection('list', 'default', 'visible')

        expect(tracker.hasVisibleSessionConnection('default', 'session-1')).toBe(false)
    })

    it('stops matching when the chat is hidden or disconnected', () => {
        const tracker = new VisibilityTracker()
        tracker.registerConnection('chat', 'default', 'visible', 'session-1')
        tracker.setVisibility('chat', 'default', 'hidden')

        expect(tracker.hasVisibleSessionConnection('default', 'session-1')).toBe(false)

        tracker.setVisibility('chat', 'default', 'visible')
        tracker.removeConnection('chat')

        expect(tracker.hasVisibleSessionConnection('default', 'session-1')).toBe(false)
    })
})
