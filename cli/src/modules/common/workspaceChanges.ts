import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { WorkspaceChanges } from '@hapi/protocol'

const SNAPSHOT_TIMEOUT_MS = 15_000
const MAX_DIFF_BYTES = 4 * 1024 * 1024

type WorkspaceTreeSnapshot = {
    repoRoot: string
    tree: string
}

function runGit(
    cwd: string,
    args: string[],
    options: { env?: NodeJS.ProcessEnv; maxBuffer?: number } = {}
): string {
    return execFileSync('git', args, {
        cwd,
        encoding: 'utf8',
        timeout: SNAPSHOT_TIMEOUT_MS,
        maxBuffer: options.maxBuffer ?? MAX_DIFF_BYTES,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: options.env,
    })
}

function captureWorkspaceTree(cwd: string): WorkspaceTreeSnapshot | null {
    let repoRoot: string
    try {
        repoRoot = runGit(cwd, ['rev-parse', '--show-toplevel']).trim()
    } catch {
        return null
    }
    if (!repoRoot) return null

    const temporaryDirectory = mkdtempSync(join(tmpdir(), 'hapi-turn-diff-'))
    const temporaryIndex = join(temporaryDirectory, 'index')
    const env = { ...process.env, GIT_INDEX_FILE: temporaryIndex }

    try {
        try {
            runGit(repoRoot, ['read-tree', 'HEAD'], { env })
        } catch {
            runGit(repoRoot, ['read-tree', '--empty'], { env })
        }
        runGit(repoRoot, ['add', '-A', '--', '.'], { env })
        const tree = runGit(repoRoot, ['write-tree'], { env }).trim()
        return tree ? { repoRoot, tree } : null
    } catch {
        return null
    } finally {
        rmSync(temporaryDirectory, { recursive: true, force: true })
    }
}

function parseNumstat(output: string): Pick<WorkspaceChanges, 'additions' | 'deletions'> {
    let additions = 0
    let deletions = 0
    for (const line of output.split('\n')) {
        if (!line) continue
        const [added, deleted] = line.split('\t', 2)
        if (added !== '-') additions += Number.parseInt(added ?? '0', 10) || 0
        if (deleted !== '-') deletions += Number.parseInt(deleted ?? '0', 10) || 0
    }
    return { additions, deletions }
}

function isMaxBufferError(error: unknown): boolean {
    if (!(error instanceof Error)) return false
    const code = (error as NodeJS.ErrnoException).code
    return code === 'ENOBUFS' || error.message.includes('maxBuffer')
}

function compareWorkspaceTrees(
    before: WorkspaceTreeSnapshot,
    after: WorkspaceTreeSnapshot
): WorkspaceChanges | null {
    if (before.repoRoot !== after.repoRoot || before.tree === after.tree) return null

    try {
        const nameOutput = runGit(after.repoRoot, [
            'diff', '--name-only', '-z', '--no-ext-diff', '--find-renames', before.tree, after.tree, '--'
        ])
        const filesChanged = nameOutput.split('\0').filter(Boolean).length
        const stats = parseNumstat(runGit(after.repoRoot, [
            'diff', '--numstat', '--no-ext-diff', '--find-renames', before.tree, after.tree, '--'
        ]))

        try {
            const diff = runGit(after.repoRoot, [
                'diff', '--no-ext-diff', '--find-renames', before.tree, after.tree, '--'
            ], { maxBuffer: MAX_DIFF_BYTES })
            return { diff, filesChanged, ...stats }
        } catch (error) {
            if (!isMaxBufferError(error)) return null
            return { diff: null, filesChanged, ...stats, truncated: true }
        }
    } catch {
        return null
    }
}

export class WorkspaceChangesTracker {
    private snapshot: WorkspaceTreeSnapshot | null = null

    begin(cwd: string | null | undefined): void {
        if (this.snapshot || !cwd) return
        this.snapshot = captureWorkspaceTree(cwd)
    }

    finish(cwd: string | null | undefined): WorkspaceChanges | null {
        const before = this.snapshot
        this.snapshot = null
        if (!before || !cwd) return null
        const after = captureWorkspaceTree(cwd)
        return after ? compareWorkspaceTrees(before, after) : null
    }
}
