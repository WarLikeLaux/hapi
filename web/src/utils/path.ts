import type { SessionMetadataSummary } from '@/types/api'

export function resolveDisplayPath(path: string, metadata: SessionMetadataSummary | null): string {
    if (!metadata?.path) return path

    const root = metadata.path
    const lowerPath = path.toLowerCase()
    const lowerRoot = root.toLowerCase()
    if (!lowerPath.startsWith(lowerRoot)) return path

    const remainder = path.slice(root.length)
    if (remainder !== '' && !remainder.startsWith('/') && !remainder.startsWith('\\')) return path

    let out = remainder
    if (out.startsWith('/') || out.startsWith('\\')) {
        out = out.slice(1)
    }
    return out.length === 0 ? '<root>' : out
}

export function basename(path: string): string {
    const normalized = path.replace(/\\/g, '/')
    const parts = normalized.split('/').filter(Boolean)
    return parts.length > 0 ? parts[parts.length - 1] : path
}

/** Format an individual path with enough parent context for compact pickers. */
export function getPathDisplayName(path: string): string {
    if (path === 'Other') return path
    const parts = path.split(/[\\/]+/).filter(Boolean)
    if (parts.length === 0) return path
    if (parts.length === 1) return parts[0]
    return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`
}

/** Use the shortest path suffix that distinguishes same-named projects. */
export function getPathDisplayNames(paths: readonly string[]): Map<string, string> {
    const uniquePaths = [...new Set(paths)]
    const partsByPath = new Map(uniquePaths.map((path) => [
        path,
        path === 'Other' ? [path] : path.split(/[\\/]+/).filter(Boolean)
    ]))
    const depthByPath = new Map(uniquePaths.map((path) => [path, 1]))

    while (true) {
        const pathsByLabel = new Map<string, string[]>()
        for (const path of uniquePaths) {
            const parts = partsByPath.get(path) ?? []
            const depth = Math.min(depthByPath.get(path) ?? 1, Math.max(parts.length, 1))
            const label = parts.length > 0 ? parts.slice(-depth).join('/') : path
            const key = label.toLocaleLowerCase()
            pathsByLabel.set(key, [...(pathsByLabel.get(key) ?? []), path])
        }

        let changed = false
        for (const collidingPaths of pathsByLabel.values()) {
            if (collidingPaths.length < 2) continue
            for (const path of collidingPaths) {
                const parts = partsByPath.get(path) ?? []
                const depth = depthByPath.get(path) ?? 1
                if (depth < parts.length) {
                    depthByPath.set(path, depth + 1)
                    changed = true
                }
            }
        }
        if (!changed) break
    }

    return new Map(uniquePaths.map((path) => {
        const parts = partsByPath.get(path) ?? []
        const depth = depthByPath.get(path) ?? 1
        return [path, parts.length > 0 ? parts.slice(-depth).join('/') : path]
    }))
}
