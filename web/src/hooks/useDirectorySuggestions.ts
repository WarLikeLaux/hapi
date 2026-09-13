import { useMemo } from 'react'
import type { MachineDirectoryEntry, SessionSummary } from '@/types/api'

export type DirectorySearchTarget = {
    directory: string
    nameQuery: string
}

function isWindowsPath(path: string): boolean {
    return /^[A-Za-z]:[\\/]/.test(path) || path.includes('\\')
}

function normalizePath(path: string): string {
    const normalized = path.replace(/[\\/]+/g, '/')
    if (normalized === '/' || /^[A-Za-z]:\/$/.test(normalized)) return normalized
    if (/^[A-Za-z]:$/.test(normalized)) return `${normalized}/`
    return normalized.replace(/\/+$/, '')
}

function restoreSeparator(path: string, sample: string): string {
    return isWindowsPath(sample) ? path.replace(/\//g, '\\') : path
}

function isPathWithin(candidate: string, root: string): boolean {
    const normalizedCandidate = normalizePath(candidate)
    const normalizedRoot = normalizePath(root)
    const windows = isWindowsPath(candidate) || isWindowsPath(root)
    const comparableCandidate = windows ? normalizedCandidate.toLowerCase() : normalizedCandidate
    const comparableRoot = windows ? normalizedRoot.toLowerCase() : normalizedRoot
    return comparableCandidate === comparableRoot
        || comparableCandidate.startsWith(comparableRoot.endsWith('/') ? comparableRoot : `${comparableRoot}/`)
}

export function resolveDirectorySearchTarget(
    query: string,
    workspaceRoots: readonly string[]
): DirectorySearchTarget | null {
    const trimmed = query.trim()
    if (!trimmed || workspaceRoots.length === 0) return null

    const exactRoot = workspaceRoots.find((root) => normalizePath(root) === normalizePath(trimmed))
    if (exactRoot) {
        return { directory: exactRoot, nameQuery: '' }
    }

    const normalized = normalizePath(trimmed)
    const hasTrailingSeparator = /[\\/]$/.test(trimmed)
    const lastSeparator = normalized.lastIndexOf('/')
    const normalizedParent = hasTrailingSeparator
        ? normalized
        : lastSeparator <= 0
            ? '/'
            : normalized.slice(0, lastSeparator)
    const directory = restoreSeparator(
        /^[A-Za-z]:$/.test(normalizedParent) ? `${normalizedParent}/` : normalizedParent,
        trimmed
    )

    if (!workspaceRoots.some((root) => isPathWithin(directory, root))) return null

    return {
        directory,
        nameQuery: hasTrailingSeparator ? '' : normalized.slice(lastSeparator + 1)
    }
}

export function getMatchingDirectoryPaths(
    target: DirectorySearchTarget,
    entries: readonly MachineDirectoryEntry[]
): string[] {
    const lowered = target.nameQuery.toLowerCase()
    const separator = isWindowsPath(target.directory) ? '\\' : '/'
    const base = target.directory.replace(/[\\/]+$/, '')

    return entries
        .filter((entry) => entry.type === 'directory' && entry.name.toLowerCase().includes(lowered))
        .sort((left, right) => {
            const leftPrefix = left.name.toLowerCase().startsWith(lowered)
            const rightPrefix = right.name.toLowerCase().startsWith(lowered)
            if (leftPrefix !== rightPrefix) return leftPrefix ? -1 : 1
            return left.name.localeCompare(right.name)
        })
        .map((entry) => `${base || separator}${base ? separator : ''}${entry.name}`)
}

export function useDirectorySuggestions(
    machineId: string | null,
    sessions: SessionSummary[],
    recentPaths: string[]
): string[] {
    return useMemo(() => {
        const machineSessions = machineId
            ? sessions.filter((session) => session.metadata?.machineId === machineId)
            : sessions

        const sessionPaths = machineSessions
            .map((session) => session.metadata?.path)
            .filter((path): path is string => Boolean(path))

        const worktreePaths = machineSessions
            .map((session) => session.metadata?.worktree?.basePath)
            .filter((path): path is string => Boolean(path))

        const dedupedRecent = [...new Set(recentPaths)]
        const recentSet = new Set(dedupedRecent)

        const otherPaths = [...new Set([...sessionPaths, ...worktreePaths])]
            .filter((path) => !recentSet.has(path))
            .sort((a, b) => a.localeCompare(b))

        return [...dedupedRecent, ...otherPaths]
    }, [machineId, sessions, recentPaths])
}
