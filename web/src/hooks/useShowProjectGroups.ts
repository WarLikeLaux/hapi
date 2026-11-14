import { useCallback, useEffect, useState } from 'react'

const KEY = 'hapi-show-project-groups'
const CHANGE = 'hapi-show-project-groups-changed'

function readPreference(): boolean {
    try { return typeof window !== 'undefined' && localStorage.getItem(KEY) === 'true' } catch { return false }
}

export function useShowProjectGroups() {
    const [showProjectGroups, setShow] = useState(readPreference)
    useEffect(() => {
        const refresh = () => setShow(readPreference())
        const onChange = (event: Event) => setShow((event as CustomEvent<boolean>).detail)
        const onStorage = (event: StorageEvent) => { if (event.key === KEY || event.key === null) refresh() }
        window.addEventListener('storage', onStorage)
        window.addEventListener(CHANGE, onChange)
        return () => { window.removeEventListener('storage', onStorage); window.removeEventListener(CHANGE, onChange) }
    }, [])
    const setShowProjectGroups = useCallback((value: boolean) => {
        try { if (value) localStorage.setItem(KEY, 'true'); else localStorage.removeItem(KEY) } catch { /* preference is best effort */ }
        setShow(value)
        window.dispatchEvent(new CustomEvent(CHANGE, { detail: value }))
    }, [])
    return { showProjectGroups, setShowProjectGroups }
}
