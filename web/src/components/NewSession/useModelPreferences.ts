import { useCallback, useEffect, useRef, useState } from 'react'
import type { ApiClient, ModelPreference } from '@/api/client'

export function useModelPreferences(api: ApiClient) {
    const [preferences, setPreferences] = useState<ModelPreference[]>([])
    const [error, setError] = useState<string | null>(null)
    const [loading, setLoading] = useState(true)
    const pendingWrite = useRef<Promise<void>>(Promise.resolve())

    useEffect(() => {
        let active = true
        void api.getModelPreferences().then(result => {
            if (active) setPreferences(result.preferences)
        }).catch(() => {
            if (active) setError('newSession.models.loadFailed')
        }).finally(() => { if (active) setLoading(false) })
        return () => { active = false }
    }, [api])

    const save = useCallback((preference: ModelPreference) => {
        const write = pendingWrite.current.then(async () => {
            try {
                const result = await api.saveModelPreference(preference)
                setPreferences(current => {
                    const index = current.findIndex(row => row.agent === preference.agent && row.modelId === preference.modelId)
                    const next = current.filter(row => row.agent !== preference.agent || row.modelId !== preference.modelId)
                    if (result.preference.pinned || result.preference.alias || result.preference.hidden || result.preference.reasoningEffort) {
                        const keptPinOrder = index >= 0 && current[index].pinned === result.preference.pinned
                        next.splice(keptPinOrder ? index : next.length, 0, result.preference)
                    }
                    return next
                })
                setError(null)
            } catch {
                setError('newSession.models.saveFailed')
            }
        })
        pendingWrite.current = write
        return write
    }, [api])

    const reorder = useCallback((agent: ModelPreference['agent'], modelIds: string[]) => {
        const write = pendingWrite.current.then(async () => {
            try {
                const result = await api.reorderModelPreferences(agent, modelIds)
                setPreferences(result.preferences)
                setError(null)
            } catch {
                setError('newSession.models.saveFailed')
            }
        })
        pendingWrite.current = write
        return write
    }, [api])

    return { preferences, error, loading, save, reorder }
}
