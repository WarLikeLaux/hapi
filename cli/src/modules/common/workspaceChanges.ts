import { execFile, execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
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

const execFileAsync = promisify(execFile)

// Async twin of runGit for the in-turn read paths (periodic stats, on-demand
// diff): these run while the agent keeps streaming, so they must not block
// the CLI's event loop the way the sync helpers do.
async function runGitAsync(
    cwd: string,
    args: string[],
    options: { env?: NodeJS.ProcessEnv; maxBuffer?: number } = {}
): Promise<string> {
    const { stdout } = await execFileAsync('git', args, {
        cwd,
        encoding: 'utf8',
        timeout: SNAPSHOT_TIMEOUT_MS,
        maxBuffer: options.maxBuffer ?? MAX_DIFF_BYTES,
        env: options.env,
    })
    return stdout
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

async function captureWorkspaceTreeAsync(cwd: string): Promise<WorkspaceTreeSnapshot | null> {
    let repoRoot: string
    try {
        repoRoot = (await runGitAsync(cwd, ['rev-parse', '--show-toplevel'])).trim()
    } catch {
        return null
    }
    if (!repoRoot) return null

    const temporaryDirectory = mkdtempSync(join(tmpdir(), 'hapi-turn-diff-'))
    const temporaryIndex = join(temporaryDirectory, 'index')
    const env = { ...process.env, GIT_INDEX_FILE: temporaryIndex }

    try {
        try {
            await runGitAsync(repoRoot, ['read-tree', 'HEAD'], { env })
        } catch {
            await runGitAsync(repoRoot, ['read-tree', '--empty'], { env })
        }
        await runGitAsync(repoRoot, ['add', '-A', '--', '.'], { env })
        const tree = (await runGitAsync(repoRoot, ['write-tree'], { env })).trim()
        return tree ? { repoRoot, tree } : null
    } catch {
        return null
    } finally {
        rmSync(temporaryDirectory, { recursive: true, force: true })
    }
}

// Returns null for equal trees / different roots / git failure; callers map
// those to their own contract (stats tick skips, full diff reports zero).
async function compareTreesAsync(
    before: WorkspaceTreeSnapshot,
    after: WorkspaceTreeSnapshot,
    options: { includeDiff: boolean }
): Promise<WorkspaceChanges | null> {
    if (before.repoRoot !== after.repoRoot || before.tree === after.tree) return null

    try {
        const nameOutput = await runGitAsync(after.repoRoot, [
            'diff', '--name-only', '-z', '--no-ext-diff', '--find-renames', before.tree, after.tree, '--'
        ])
        const filesChanged = nameOutput.split('\0').filter(Boolean).length
        const stats = parseNumstat(await runGitAsync(after.repoRoot, [
            'diff', '--numstat', '--no-ext-diff', '--find-renames', before.tree, after.tree, '--'
        ]))

        if (!options.includeDiff) {
            return { diff: null, filesChanged, ...stats }
        }

        try {
            const diff = await runGitAsync(after.repoRoot, [
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

    // Returns true only when a fresh snapshot was actually captured, so the
    // caller can start periodic polling exactly once per turn.
    begin(cwd: string | null | undefined): boolean {
        if (this.snapshot || !cwd) return false
        this.snapshot = captureWorkspaceTree(cwd)
        return this.snapshot !== null
    }

    hasSnapshot(): boolean {
        return this.snapshot !== null
    }

    // Non-destructive in-turn read: snapshot stays for the eventual finish().
    // Returns null when there is nothing to report (no snapshot, not a repo,
    // trees unchanged, capture failed, or the turn ended mid-capture).
    async currentStats(cwd: string | null | undefined): Promise<WorkspaceChanges | null> {
        const before = this.snapshot
        if (!before || !cwd) return null
        const after = await captureWorkspaceTreeAsync(cwd)
        if (!after || this.snapshot !== before) return null
        return compareTreesAsync(before, after, { includeDiff: false })
    }

    // Non-destructive full diff for the on-demand fetch. Equal trees yield a
    // zero-diff object (the turn is still live; the agent may have reverted
    // its edits), so null is reserved for "no snapshot to diff against".
    async currentFullDiff(cwd: string | null | undefined): Promise<WorkspaceChanges | null> {
        const before = this.snapshot
        if (!before || !cwd) return null
        const after = await captureWorkspaceTreeAsync(cwd)
        if (!after || this.snapshot !== before) return null
        if (before.repoRoot !== after.repoRoot) return null
        if (before.tree === after.tree) {
            return { diff: '', filesChanged: 0, additions: 0, deletions: 0 }
        }
        return compareTreesAsync(before, after, { includeDiff: true })
    }

    finish(cwd: string | null | undefined): WorkspaceChanges | null {
        const before = this.snapshot
        this.snapshot = null
        if (!before || !cwd) return null
        const after = captureWorkspaceTree(cwd)
        return after ? compareWorkspaceTrees(before, after) : null
    }
}
