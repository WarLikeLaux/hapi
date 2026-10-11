import { describe, expect, it } from 'vitest'
import type { Session } from '@/types/api'
import { hasPendingSessionRequests, isSessionNotFoundError, SESSION_DETAIL_STALE_TIME_MS } from './useSession'

describe('isSessionNotFoundError', () => {
    it('matches hub 404 session responses', () => {
        expect(isSessionNotFoundError(new Error('HTTP 404 Not Found: {"error":"Session not found"}'))).toBe(true)
    })

    it('does not match unrelated errors', () => {
        expect(isSessionNotFoundError(new Error('HTTP 500 Internal Server Error'))).toBe(false)
        expect(isSessionNotFoundError(null)).toBe(false)
    })
})

describe('hasPendingSessionRequests', () => {
    it('returns true when agentState has pending requests', () => {
        const session = {
            agentState: { requests: { 'req-1': { tool: 'CodexBash' } } },
        } as unknown as Session
        expect(hasPendingSessionRequests(session)).toBe(true)
    })

    it('returns false when there are no requests', () => {
        expect(hasPendingSessionRequests({ agentState: { requests: {} } } as unknown as Session)).toBe(false)
        expect(hasPendingSessionRequests({ agentState: null } as unknown as Session)).toBe(false)
        expect(hasPendingSessionRequests(null)).toBe(false)
        expect(hasPendingSessionRequests(undefined)).toBe(false)
    })
})

describe('SESSION_DETAIL_STALE_TIME_MS', () => {
    // SSE patches the cache directly on session-updated events, so the REST
    // endpoint is just a cold-start / reconnect-recovery path.  A long staleTime
    // suppresses focus-refetch and remount-refetch storms — primary lever for
    // the refetch-storm fix (tiann/hapi#884).
    it('is set to a value that suppresses focus/mount refetches', () => {
        expect(SESSION_DETAIL_STALE_TIME_MS).toBeGreaterThanOrEqual(10_000)
    })
})
