import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { Session } from '@/types/api'
import { APP_TITLE, useSessionBrowserTitle } from './useSessionBrowserTitle'

function makeSession(metadata: Session['metadata']): Session {
    return {
        id: '1234567890abcdef',
        active: true,
        thinking: false,
        activeAt: 0,
        updatedAt: 0,
        metadata,
    } as Session
}

describe('useSessionBrowserTitle', () => {
    it('keeps the browser tab title pinned to HAPI and does not append session names', () => {
        document.title = 'Other Title'
        const initialSession = makeSession({
            path: '/work/hapi',
            host: 'localhost',
            summary: { text: 'Initial summary', updatedAt: 1 },
        })

        const { rerender, unmount } = renderHook(
            ({ session }) => useSessionBrowserTitle(session),
            { initialProps: { session: initialSession } },
        )

        expect(document.title).toBe(APP_TITLE)

        rerender({
            session: makeSession({
                ...initialSession.metadata!,
                name: 'Renamed session',
            }),
        })

        expect(document.title).toBe(APP_TITLE)

        unmount()
        expect(document.title).toBe(APP_TITLE)
    })
})
