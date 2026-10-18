import { useCallback, useMemo, useRef, useState } from 'react'
import type { ApiClient } from '@/api/client'
import type { Machine, SessionSummary } from '@/types/api'
import { DirectorySection } from './DirectorySection'
import { getRecentProjectPaths } from '@/hooks/useRecentProjectPaths'
import { useProjectPaths } from '@/hooks/useProjectPaths'
import { useSessionContextFilter } from '@/hooks/useSessionContextFilter'
import { useSessionContextHubSync } from '@/hooks/useSessionContextHubSync'
import { getMatchingDirectoryPaths, resolveDirectorySearchTarget, useDirectorySuggestions } from '@/hooks/useDirectorySuggestions'
import { useActiveSuggestions, type Suggestion } from '@/hooks/useActiveSuggestions'
import { useMachinePathsExists } from '@/hooks/useMachinePathsExists'

/** Shared and per-chat projects use the same recent paths, browsing and keyboard completion. */
export function ProjectDirectory(props: {
    api: ApiClient; machine?: Machine; sessions: SessionSummary[]; value: string; disabled: boolean; compact?: boolean
    onChange: (value: string) => void; onBrowse?: () => void
}) {
    const [focused, setFocused] = useState(false)
    const [suppressed, setSuppressed] = useState(false)
    const context = useSessionContextFilter(useSessionContextHubSync())
    const { workPaths, recentPaths } = useProjectPaths(props.sessions, props.machine?.id ?? null, context)
    const recent = useMemo(() => getRecentProjectPaths(props.sessions, props.machine?.id ?? null), [props.sessions, props.machine?.id])
    const allPaths = useDirectorySuggestions(props.machine?.id ?? null, props.sessions, recent)
    const { pathExistence } = useMachinePathsExists(props.api, props.machine?.id ?? null, allPaths)
    const listings = useRef(new Map<string, Awaited<ReturnType<ApiClient['listMachineDirectory']>>>())
    const suggest = useCallback(async (query: string): Promise<Suggestion[]> => {
        const target = resolveDirectorySearchTarget(query, props.machine?.metadata?.workspaceRoots ?? [])
        let filesystem: string[] = []
        if (target && props.machine) {
            const key = JSON.stringify([props.machine.id, target.directory])
            let result = listings.current.get(key)
            if (!result) {
                try {
                    result = await props.api.listMachineDirectory(props.machine.id, target.directory)
                    if (result.success) listings.current.set(key, result)
                } catch { /* Recent paths remain available if directory listing fails. */ }
            }
            if (result?.success && result.entries) filesystem = getMatchingDirectoryPaths(target, result.entries)
        }
        return [...new Set([...filesystem, ...allPaths.filter(path => pathExistence[path] && path.toLowerCase().includes(query.toLowerCase()))])]
            .slice(0, 8).map(path => ({ key: path, text: path, label: path }))
    }, [props.machine, props.api, allPaths, pathExistence])
    const [suggestions, selectedIndex, up, down, clear] = useActiveSuggestions(focused && !suppressed && !props.disabled ? props.value : null, suggest)
    function select(path: string) { setSuppressed(true); clear(); props.onChange(path) }
    return <DirectorySection directory={props.value} suggestions={suggestions} selectedIndex={selectedIndex}
        isDisabled={props.disabled} workPaths={props.compact ? [] : workPaths} recentPaths={props.compact ? [] : recentPaths}
        onDirectoryChange={value => { setSuppressed(false); props.onChange(value) }}
        onDirectoryFocus={() => { setFocused(true); setSuppressed(false) }} onDirectoryBlur={() => setFocused(false)}
        onDirectoryKeyDown={event => {
            if (suggestions.length && ['ArrowDown', 'ArrowUp', 'Enter', 'Tab'].includes(event.key)) {
                event.preventDefault()
                if (event.key === 'ArrowDown') down()
                else if (event.key === 'ArrowUp') up()
                else if (suggestions[selectedIndex]) select(suggestions[selectedIndex].text)
            }
            if (event.key === 'Escape') { setSuppressed(true); clear() }
        }} onSuggestionSelect={index => { if (suggestions[index]) select(suggestions[index].text) }}
        onPathClick={select} onChooseFolder={props.onBrowse} />
}
