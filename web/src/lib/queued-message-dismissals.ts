const STORAGE_KEY = 'hapi.dismissedIndeterminateMessages.v1'
const MAX_DISMISSALS = 200

type StoredDismissals = Record<string, string[]>

function readDismissals(): StoredDismissals {
    if (typeof window === 'undefined') return {}
    try {
        const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}') as unknown
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
        return Object.fromEntries(
            Object.entries(parsed).flatMap(([sessionId, localIds]) => (
                Array.isArray(localIds)
                    ? [[sessionId, localIds.filter((id): id is string => typeof id === 'string')]]
                    : []
            ))
        )
    } catch {
        return {}
    }
}

function writeDismissals(dismissals: StoredDismissals): void {
    if (typeof window === 'undefined') return
    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(dismissals))
    } catch {
        // Dismissal still works for the current render through queueDismissed.
    }
}

export function isIndeterminateMessageDismissed(sessionId: string, localId: string): boolean {
    return readDismissals()[sessionId]?.includes(localId) === true
}

export function persistIndeterminateMessageDismissal(sessionId: string, localId: string): void {
    const dismissals = readDismissals()
    const current = dismissals[sessionId] ?? []
    if (current.includes(localId)) return
    dismissals[sessionId] = [...current, localId].slice(-MAX_DISMISSALS)
    writeDismissals(dismissals)
}

export function clearIndeterminateMessageDismissal(sessionId: string, localId: string): void {
    const dismissals = readDismissals()
    const current = dismissals[sessionId]
    if (!current?.includes(localId)) return
    const next = current.filter((id) => id !== localId)
    if (next.length > 0) dismissals[sessionId] = next
    else delete dismissals[sessionId]
    writeDismissals(dismissals)
}
