/**
 * Helpers for the optional external-editor integration (Settings > Display >
 * Links > external editor base URL). A base URL set means chat file links are
 * offered to the live editor first; only the fallback opens a new browser tab.
 */

export type ExternalEditorFileTarget = {
    file: string
    line?: number
    column?: number
}

/**
 * Build a code-server style URL that opens `file` (optionally at
 * line/column) inside `folder`. `codeHost` is the host part of the base URL
 * and goes into the `vscode-remote://` URI the workbench understands.
 */
export function buildExternalEditorFileUrl(
    baseUrl: string,
    codeHost: string,
    folder: string,
    target: ExternalEditorFileTarget
): string {
    let remote = `vscode-remote://${codeHost}${target.file}`
    if (target.line !== undefined) {
        remote += `:${target.line}${target.column !== undefined ? `:${target.column}` : ''}`
    }
    const payload = JSON.stringify(
        target.line !== undefined
            ? [['gotoLineMode', 'true'], ['openFile', remote]]
            : [['openFile', remote]]
    )
    return `${baseUrl}/?folder=${encodeURIComponent(folder)}&payload=${encodeURIComponent(payload)}`
}

/**
 * Pick the editor folder for a fallback open: the session workspace root when
 * the file lives inside it, otherwise the file's parent directory.
 */
export function resolveExternalEditorFolder(workspaceRoot: string | null, file: string): string {
    if (workspaceRoot) {
        const root = workspaceRoot.replace(/\/+$/, '')
        if (file === root || file.startsWith(root + '/')) return root
    }
    const slash = file.lastIndexOf('/')
    return slash > 0 ? file.slice(0, slash) : '/'
}
