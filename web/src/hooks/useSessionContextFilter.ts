import { useCallback, useEffect, useState } from 'react'
import type { SessionContextId } from '@/lib/sessionContexts'

const ACTIVE_CONTEXT_KEY = 'hapi-active-session-context'
const PROJECT_OVERRIDES_KEY = 'hapi-project-context-map'
const DEFAULT_CONTEXT: SessionContextId = 'all'

function isBrowser(): boolean {
    return typeof window !== 'undefined' && typeof document !== 'undefined'
}

function safeGetItem(key: string): string | null {
    if (!isBrowser()) return null
    try {
        return localStorage.getItem(key)
    } catch {
        return null
    }
}

function safeSetItem(key: string, value: string): void {
    if (!isBrowser()) return
    try {
        localStorage.setItem(key, value)
    } catch {
        // Ignore
    }
}

function safeRemoveItem(key: string): void {
    if (!isBrowser()) return
    try {
        localStorage.removeItem(key)
    } catch {
        // Ignore
    }
}

function parseActiveContext(raw: string | null): SessionContextId {
    if (raw === 'work' || raw === 'lab' || raw === 'chill' || raw === 'all') {
        return raw
    }
    return DEFAULT_CONTEXT
}

function parseProjectOverrides(raw: string | null): Record<string, SessionContextId> {
    if (!raw) return {}
    try {
        const parsed = JSON.parse(raw)
        if (parsed && typeof parsed === 'object') {
            return parsed as Record<string, SessionContextId>
        }
    } catch {
        // Ignore
    }
    return {}
}

export function useSessionContextFilter() {
    const [activeContext, setActiveContextState] = useState<SessionContextId>(() =>
        parseActiveContext(safeGetItem(ACTIVE_CONTEXT_KEY))
    )

    const [projectOverrides, setProjectOverridesState] = useState<Record<string, SessionContextId>>(() =>
        parseProjectOverrides(safeGetItem(PROJECT_OVERRIDES_KEY))
    )

    useEffect(() => {
        if (!isBrowser()) return

        const onStorage = (event: StorageEvent) => {
            if (event.key === ACTIVE_CONTEXT_KEY) {
                setActiveContextState(parseActiveContext(event.newValue))
            } else if (event.key === PROJECT_OVERRIDES_KEY) {
                setProjectOverridesState(parseProjectOverrides(event.newValue))
            }
        }

        window.addEventListener('storage', onStorage)
        return () => window.removeEventListener('storage', onStorage)
    }, [])

    const setActiveContext = useCallback((context: SessionContextId) => {
        setActiveContextState(context)
        if (context === DEFAULT_CONTEXT) {
            safeRemoveItem(ACTIVE_CONTEXT_KEY)
        } else {
            safeSetItem(ACTIVE_CONTEXT_KEY, context)
        }
    }, [])

    const setProjectContextOverride = useCallback((projectKey: string, context: SessionContextId | null) => {
        setProjectOverridesState((prev) => {
            const next = { ...prev }
            if (context === null || context === 'all') {
                delete next[projectKey]
            } else {
                next[projectKey] = context
            }
            if (Object.keys(next).length === 0) {
                safeRemoveItem(PROJECT_OVERRIDES_KEY)
            } else {
                safeSetItem(PROJECT_OVERRIDES_KEY, JSON.stringify(next))
            }
            return next
        })
    }, [])

    return {
        activeContext,
        setActiveContext,
        projectOverrides,
        setProjectContextOverride,
    }
}
