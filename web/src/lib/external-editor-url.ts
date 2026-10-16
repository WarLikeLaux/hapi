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
 * Stable browser tab name per editor folder: clicks for project B focus or
 * create B's own tab and never touch (or blank) the tab holding project A.
 */
export function editorTabName(folder: string): string {
    const slug = folder.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'root'
    return `hapi-code-${slug}`
}

/**
 * Build a plain folder URL (no payload): focuses or opens the editor tab on
 * the project without triggering any file open. Used as the synchronous
 * window.open target so repeat clicks focus the same tab with no flicker.
 */
export function buildExternalEditorFolderUrl(baseUrl: string, folder: string): string {
    // Encode per path segment so slashes stay readable in the address bar.
    const folderParam = folder.split('/').map((s) => encodeURIComponent(s)).join('/')
    return `${baseUrl}/?folder=${folderParam}`
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
    // Encode per path segment so slashes stay readable in the address bar.
    const folderParam = folder.split('/').map((s) => encodeURIComponent(s)).join('/')
    return `${baseUrl}/?folder=${folderParam}&payload=${encodeURIComponent(payload)}`
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
