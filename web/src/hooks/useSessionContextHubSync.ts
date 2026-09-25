import { useEffect, useMemo, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { UpdateHubSettingsRequest } from '@hapi/protocol/apiTypes'
import { useAppContext } from '@/lib/app-context'
import { getNamespaceFromToken } from '@/components/settings/SettingsNav'
import { queryKeys } from '@/lib/query-keys'
import type { SessionContextId } from '@/lib/sessionContexts'

const WORK_ALIASES_KEY = 'hapi-context-work-aliases'
const PROJECT_OVERRIDES_KEY = 'hapi-project-context-map'
const SESSION_OVERRIDES_KEY = 'hapi-session-context-map'

function safeGetItem(key: string): string | null {
    try {
        return localStorage.getItem(key)
    } catch {
        return null
    }
}

function safeRemoveItem(key: string): void {
    try {
        localStorage.removeItem(key)
    } catch {
        // Ignore
    }
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
        // Ignore
    }
    return raw.split(',').map((s) => s.trim()).filter(Boolean)
}

function isEmptyOverrides(map: Record<string, SessionContextId> | undefined): boolean {
    return !map || Object.keys(map).length === 0
}

export type SessionContextHubSync = {
    ready: boolean
    canPersist: boolean
    workAliases: string[]
    sessionOverrides: Record<string, SessionContextId>
    projectOverrides: Record<string, SessionContextId>
    persist: (patch: UpdateHubSettingsRequest) => void
}

export function useSessionContextHubSync(): SessionContextHubSync | null {
    const { api, token } = useAppContext()
    const queryClient = useQueryClient()
    const isOwner = Boolean(token) && getNamespaceFromToken(token!) === 'default'
    const migratedRef = useRef(false)

    const query = useQuery({
        queryKey: queryKeys.hubSettings,
        queryFn: async () => {
            if (!api) throw new Error('API unavailable')
            return await api.getHubSettings()
        },
        enabled: Boolean(api),
        staleTime: 30_000,
    })

    const mutation = useMutation({
        mutationFn: async (patch: UpdateHubSettingsRequest) => {
            if (!api) throw new Error('API unavailable')
            return await api.updateHubSettings(patch)
        },
        onMutate: async (patch) => {
            await queryClient.cancelQueries({ queryKey: queryKeys.hubSettings })
            const previous = queryClient.getQueryData<Awaited<ReturnType<NonNullable<typeof api>['getHubSettings']>>>(
                queryKeys.hubSettings
            )
            if (previous) {
                queryClient.setQueryData(queryKeys.hubSettings, { ...previous, ...patch })
            }
            return { previous }
        },
        onError: (_error, _patch, context) => {
            if (context?.previous) {
                queryClient.setQueryData(queryKeys.hubSettings, context.previous)
            }
        },
        onSuccess: (data) => {
            queryClient.setQueryData(queryKeys.hubSettings, data)
        },
    })

    const data = query.data

    useEffect(() => {
        if (!isOwner || !data || migratedRef.current) return
        migratedRef.current = true

        const patch: UpdateHubSettingsRequest = {}
        const localAliases = parseAliasesList(safeGetItem(WORK_ALIASES_KEY))
        if (localAliases.length > 0 && (data.workContextAliases ?? []).length === 0) {
            patch.workContextAliases = localAliases
            safeRemoveItem(WORK_ALIASES_KEY)
        }

        const localSession = parseOverridesMap(safeGetItem(SESSION_OVERRIDES_KEY))
        if (!isEmptyOverrides(localSession) && isEmptyOverrides(data.sessionContextOverrides)) {
            patch.sessionContextOverrides = localSession as UpdateHubSettingsRequest['sessionContextOverrides']
            safeRemoveItem(SESSION_OVERRIDES_KEY)
        }

        const localProject = parseOverridesMap(safeGetItem(PROJECT_OVERRIDES_KEY))
        if (!isEmptyOverrides(localProject) && isEmptyOverrides(data.projectContextOverrides)) {
            patch.projectContextOverrides = localProject as UpdateHubSettingsRequest['projectContextOverrides']
            safeRemoveItem(PROJECT_OVERRIDES_KEY)
        }

        if (Object.keys(patch).length > 0) {
            mutation.mutate(patch)
        }
    }, [data, isOwner, mutation.mutate])

    return useMemo(() => {
        if (!api || !data) return null

        return {
            ready: true,
            canPersist: isOwner,
            workAliases: data.workContextAliases ?? [],
            sessionOverrides: (data.sessionContextOverrides ?? {}) as Record<string, SessionContextId>,
            projectOverrides: (data.projectContextOverrides ?? {}) as Record<string, SessionContextId>,
            persist: (patch: UpdateHubSettingsRequest) => {
                if (!isOwner) return
                mutation.mutate(patch)
            },
        }
    }, [api, data, isOwner, mutation])
}
