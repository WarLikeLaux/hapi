import { useCallback, useMemo } from 'react'

const STORAGE_KEY = 'hapi:lastMachineId'

/** Remembers the machine the user last launched a session on, so Create
 *  Session can preselect it. The recent-paths list itself is derived from the
 *  hub's session data (see useRecentProjectPaths). */
export function useLastUsedMachine() {
    const getLastUsedMachineId = useCallback((): string | null => {
        try {
            return localStorage.getItem(STORAGE_KEY)
        } catch {
            return null
        }
    }, [])

    const setLastUsedMachineId = useCallback((machineId: string): void => {
        try {
            localStorage.setItem(STORAGE_KEY, machineId)
        } catch {
            // Ignore storage errors
        }
    }, [])

    return useMemo(() => ({
        getLastUsedMachineId,
        setLastUsedMachineId,
    }), [getLastUsedMachineId, setLastUsedMachineId])
}
