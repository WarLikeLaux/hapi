import { isObject } from '@hapi/protocol'

export type PatchFile = { path: string; change: Record<string, unknown> }

export function patchFiles(value: unknown): PatchFile[] {
    if (Array.isArray(value)) {
        return value.flatMap((entry) => {
            if (!isObject(entry)) return []
            const path = entry.path ?? entry.file ?? entry.filePath ?? entry.file_path
            return typeof path === 'string' ? [{ path, change: entry }] : []
        })
    }
    if (!isObject(value)) return []
    return Object.entries(value).flatMap(([path, change]) => {
        if (!isObject(change)) return []
        const actualPath = change.path ?? change.file ?? change.filePath ?? change.file_path
        return [{ path: typeof actualPath === 'string' ? actualPath : path, change }]
    })
}
