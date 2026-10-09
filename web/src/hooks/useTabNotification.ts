import { useEffect, useRef } from 'react'
import { resetFavicon, setFavicon } from '@/lib/favicon'
import { useDocumentVisibility } from './useDocumentVisibility'

export const APP_TITLE = 'HAPI'
export const DEFAULT_FAVICON = '/icon.png'
export const TAB_BLINK_INTERVAL_MS = 1200

export function getUnreadBadgeIcon(count: number): string {
    if (count <= 0) {
        return DEFAULT_FAVICON
    }
    const key = count <= 9 ? String(count) : '9plus'
    return `/badge-${key}.png`
}

export function formatUnreadTitle(count: number): string {
    if (count <= 0) {
        return APP_TITLE
    }
    return count === 1 ? '1 new message' : `${count} new messages`
}

export function useTabNotification(unreadCount: number): void {
    const isVisible = useDocumentVisibility()
    const phaseRef = useRef<number>(0)

    useEffect(() => {
        // When document is visible or there are no unread sessions/messages, keep the title and favicon default
        if (isVisible || unreadCount <= 0) {
            document.title = APP_TITLE
            resetFavicon()
            phaseRef.current = 0
            return
        }

        // When document is hidden and there are unread messages: alternate between alert and default
        const alertTitle = formatUnreadTitle(unreadCount)
        const alertIcon = getUnreadBadgeIcon(unreadCount)

        const tick = () => {
            phaseRef.current = phaseRef.current === 0 ? 1 : 0
            if (phaseRef.current === 1) {
                document.title = alertTitle
                setFavicon(alertIcon)
            } else {
                document.title = APP_TITLE
                resetFavicon()
            }
        }

        // Trigger first alert phase immediately so user doesn't wait 1.2s to notice
        tick()

        const intervalId = window.setInterval(tick, TAB_BLINK_INTERVAL_MS)

        return () => {
            window.clearInterval(intervalId)
            document.title = APP_TITLE
            resetFavicon()
            phaseRef.current = 0
        }
    }, [isVisible, unreadCount])
}
