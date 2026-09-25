import { useCallback, useEffect, useState } from 'react'
import type { UpdateHubSettingsRequest } from '@hapi/protocol/apiTypes'
import type { SessionContextId, SessionContextOptions } from '@/lib/sessionContexts'
import type { SessionContextHubSync } from '@/hooks/useSessionContextHubSync'

const ACTIVE_CONTEXT_KEY = 'hapi-active-session-context'
const PROJECT_OVERRIDES_KEY = 'hapi-project-context-map'
const SESSION_OVERRIDES_KEY = 'hapi-session-context-map'
const WORK_ALIASES_KEY = 'hapi-context-work-aliases'
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

function parseOverridesMap(raw: string | null): Record<string, SessionContextId> {
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

function parseAliasesList(raw: string | null): string[] {
    if (!raw) return []
    try {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed)) {
            return parsed.map((s) => String(s).trim()).filter(Boolean)
        }
    } catch {
        // Fallback to comma-separated format
    }
    return raw.split(',').map((s) => s.trim()).filter(Boolean)
}

function applyOverride(
    prev: Record<string, SessionContextId>,
    key: string,
    context: SessionContextId | null
): Record<string, SessionContextId> {
    const next = { ...prev }
    if (context === null || context === 'all') {
        delete next[key]
    } else {
        next[key] = context
    }
    return next
}

function persistOverridesMap(key: string, map: Record<string, SessionContextId>): void {
    if (Object.keys(map).length === 0) {
        safeRemoveItem(key)
    } else {
        safeSetItem(key, JSON.stringify(map))
    }
}

function toHubOverridePatch(
    map: Record<string, SessionContextId>
): UpdateHubSettingsRequest['sessionContextOverrides'] {
    const out: Record<string, 'work' | 'lab' | 'chill'> = {}
    for (const [entryKey, value] of Object.entries(map)) {
        if (value === 'work' || value === 'lab' || value === 'chill') {
            out[entryKey] = value
        }
    }
    return out
}

export function useSessionContextFilter(hubSync?: SessionContextHubSync | null) {
    const useHub = hubSync?.ready === true

    const [activeContext, setActiveContextState] = useState<SessionContextId>(() =>
        parseActiveContext(safeGetItem(ACTIVE_CONTEXT_KEY))
    )

    const [localProjectOverrides, setLocalProjectOverridesState] = useState<Record<string, SessionContextId>>(() =>
        parseOverridesMap(safeGetItem(PROJECT_OVERRIDES_KEY))
    )

    const [localSessionOverrides, setLocalSessionOverridesState] = useState<Record<string, SessionContextId>>(() =>
        parseOverridesMap(safeGetItem(SESSION_OVERRIDES_KEY))
    )

    const [localWorkAliases, setLocalWorkAliasesState] = useState<string[]>(() =>
        parseAliasesList(safeGetItem(WORK_ALIASES_KEY))
    )

    const projectOverrides = useHub ? hubSync!.projectOverrides : localProjectOverrides
    const sessionOverrides = useHub ? hubSync!.sessionOverrides : localSessionOverrides
    const workAliases = useHub ? hubSync!.workAliases : localWorkAliases

    useEffect(() => {
        if (!isBrowser() || useHub) return

        const onStorage = (event: StorageEvent) => {
            if (event.key === ACTIVE_CONTEXT_KEY) {
                setActiveContextState(parseActiveContext(event.newValue))
            } else if (event.key === PROJECT_OVERRIDES_KEY) {
                setLocalProjectOverridesState(parseOverridesMap(event.newValue))
            } else if (event.key === SESSION_OVERRIDES_KEY) {
                setLocalSessionOverridesState(parseOverridesMap(event.newValue))
            } else if (event.key === WORK_ALIASES_KEY) {
                setLocalWorkAliasesState(parseAliasesList(event.newValue))
            }
        }

        window.addEventListener('storage', onStorage)
        return () => window.removeEventListener('storage', onStorage)
    }, [useHub])

    const setActiveContext = useCallback((context: SessionContextId) => {
        setActiveContextState(context)
        if (context === DEFAULT_CONTEXT) {
            safeRemoveItem(ACTIVE_CONTEXT_KEY)
        } else {
            safeSetItem(ACTIVE_CONTEXT_KEY, context)
        }
    }, [])

    const setProjectContextOverride = useCallback((projectKey: string, context: SessionContextId | null) => {
        if (useHub) {
            if (!hubSync?.canPersist) return
            const next = applyOverride(hubSync.projectOverrides, projectKey, context)
            hubSync.persist({ projectContextOverrides: toHubOverridePatch(next) })
            return
        }
        setLocalProjectOverridesState((prev) => {
            const next = applyOverride(prev, projectKey, context)
            persistOverridesMap(PROJECT_OVERRIDES_KEY, next)
            return next
        })
    }, [hubSync, useHub])

    const setSessionContextOverride = useCallback((sessionId: string, context: SessionContextId | null) => {
        if (useHub) {
            if (!hubSync?.canPersist) return
            const next = applyOverride(hubSync.sessionOverrides, sessionId, context)
            hubSync.persist({ sessionContextOverrides: toHubOverridePatch(next) })
            return
        }
        setLocalSessionOverridesState((prev) => {
            const next = applyOverride(prev, sessionId, context)
            persistOverridesMap(SESSION_OVERRIDES_KEY, next)
            return next
        })
    }, [hubSync, useHub])

    const setWorkAliases = useCallback((aliases: string[]) => {
        const cleaned = aliases.map((a) => a.trim()).filter(Boolean)
        if (useHub) {
            if (!hubSync?.canPersist) return
            hubSync.persist({ workContextAliases: cleaned })
            return
        }
        setLocalWorkAliasesState(cleaned)
        if (cleaned.length === 0) {
            safeRemoveItem(WORK_ALIASES_KEY)
        } else {
            safeSetItem(WORK_ALIASES_KEY, JSON.stringify(cleaned))
        }
    }, [hubSync, useHub])

    const contextOptions: SessionContextOptions = {
        sessionOverrides,
        projectOverrides,
        workAliases,
    }

    return {
        activeContext,
        setActiveContext,
        projectOverrides,
        setProjectContextOverride,
        sessionOverrides,
        setSessionContextOverride,
        workAliases,
        setWorkAliases,
        contextOptions,
    }
}
