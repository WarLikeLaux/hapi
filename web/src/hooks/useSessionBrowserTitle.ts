import { useEffect } from 'react'
import type { Session } from '@/types/api'

export const APP_TITLE = 'HAPI'

/**
 * Ensures the browser tab title stays clean and pinned to HAPI
 * without cluttering it with session names.
 */
export function useSessionBrowserTitle(_session?: Session | null): void {
    useEffect(() => {
        document.title = APP_TITLE

        return () => {
            document.title = APP_TITLE
        }
    }, [])
}
