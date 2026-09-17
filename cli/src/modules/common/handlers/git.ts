import { execFile, type ExecFileOptions } from 'child_process'
import { promisify } from 'util'
import type {
    CommandResponse,
    GitComparisonFile,
    GitComparisonResponse,
    GitComparisonScope,
    GitStatusResponse
} from '@hapi/protocol/apiTypes'
import { RPC_METHODS } from '@hapi/protocol/rpcMethods'
import type { RpcHandlerManager } from '@/api/rpc/RpcHandlerManager'
import { validatePath } from '../pathSecurity'
import { rpcError } from '../rpcResponses'

const execFileAsync = promisify(execFile)
const MAX_GIT_OUTPUT_BYTES = 16 * 1024 * 1024

interface GitStatusRequest {
    cwd?: string
    timeout?: number
}

interface GitDiffNumstatRequest {
    cwd?: string
    staged?: boolean
    timeout?: number
}

interface GitDiffFileRequest {
    cwd?: string
    filePath: string
    staged?: boolean
    comparison?: GitComparisonScope
    timeout?: number
}

interface GitDiffRequest {
    cwd?: string
    comparison?: GitComparisonScope
    timeout?: number
}

interface GitComparisonRequest {
    cwd?: string
    scope: GitComparisonScope
    timeout?: number
}

type GitCommandResponse = CommandResponse

function currentBranchFromStatus(statusOutput: string): string | null {
    const match = statusOutput.match(/^# branch\.head (.+)$/m)
    const branch = match?.[1]?.trim()
    return branch && branch !== '(detached)' ? branch : null
}

export function buildGitLabCreateMergeRequestUrl(remoteUrl: string, branch: string): string | null {
    const trimmedRemote = remoteUrl.trim()
    const trimmedBranch = branch.trim()
    if (!trimmedRemote || !trimmedBranch) return null

    let hostname: string
    let port = ''
    let projectPath: string
    let protocol = 'https:'

    const scpMatch = trimmedRemote.match(/^(?:[^@/\s]+@)?([^:/\s]+):(.+)$/)
    if (scpMatch && !trimmedRemote.includes('://')) {
        hostname = scpMatch[1]
        projectPath = scpMatch[2]
    } else {
        try {
            const parsed = new URL(trimmedRemote)
            if (!['http:', 'https:', 'ssh:', 'git:'].includes(parsed.protocol)) return null
            hostname = parsed.hostname
            projectPath = parsed.pathname
            if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
                protocol = parsed.protocol
                port = parsed.port ? `:${parsed.port}` : ''
            }
        } catch {
            return null
        }
    }

    const normalizedHost = hostname.toLowerCase()
    if (normalizedHost === 'github.com' || normalizedHost === 'ssh.github.com') return null

    const normalizedPath = projectPath.replace(/^\/+/, '').replace(/\/+$/, '').replace(/\.git$/i, '')
    if (!normalizedPath || normalizedPath.split('/').some((segment) => !segment)) return null

    const url = new URL(`${protocol}//${hostname}${port}/${normalizedPath}/-/merge_requests/new`)
    url.searchParams.set('merge_request[source_branch]', trimmedBranch)
    return url.toString()
}

function resolveCwd(requestedCwd: string | undefined, workingDirectory: string): { cwd: string; error?: string } {
    const cwd = requestedCwd ?? workingDirectory
    const validation = validatePath(cwd, workingDirectory)
    if (!validation.valid) {
        return { cwd, error: validation.error ?? 'Invalid working directory' }
    }
    return { cwd }
}

function validateFilePath(filePath: string, workingDirectory: string): string | null {
    const validation = validatePath(filePath, workingDirectory)
    if (!validation.valid) {
        return validation.error ?? 'Invalid file path'
    }
    return null
}

async function runGitCommand(
    args: string[],
    cwd: string,
    timeout?: number,
    successfulExitCodes: readonly number[] = [0]
): Promise<GitCommandResponse> {
    try {
        const options: ExecFileOptions = {
            cwd,
            timeout: timeout ?? 10_000,
            maxBuffer: MAX_GIT_OUTPUT_BYTES
        }
        const { stdout, stderr } = await execFileAsync('git', args, options)
        return {
            success: true,
            stdout: stdout ? stdout.toString() : '',
            stderr: stderr ? stderr.toString() : '',
            exitCode: 0
        }
    } catch (error) {
        const execError = error as NodeJS.ErrnoException & {
            stdout?: string
            stderr?: string
            code?: number | string
            killed?: boolean
        }

        if (typeof execError.code === 'number' && successfulExitCodes.includes(execError.code)) {
            return {
                success: true,
                stdout: execError.stdout ? execError.stdout.toString() : '',
                stderr: execError.stderr ? execError.stderr.toString() : '',
                exitCode: execError.code
            }
        }

        if (execError.code === 'ETIMEDOUT' || execError.killed) {
            return rpcError('Command timed out', {
                stdout: execError.stdout ? execError.stdout.toString() : '',
                stderr: execError.stderr ? execError.stderr.toString() : '',
                exitCode: typeof execError.code === 'number' ? execError.code : -1
            })
        }

        return rpcError(execError.message || 'Command failed', {
            stdout: execError.stdout ? execError.stdout.toString() : '',
            stderr: execError.stderr ? execError.stderr.toString() : execError.message || 'Command failed',
            exitCode: typeof execError.code === 'number' ? execError.code : 1
        })
    }
}

async function getComparisonDiffArgs(
    comparison: GitComparisonScope,
    cwd: string,
    timeout?: number
): Promise<string[] | GitCommandResponse> {
    if (comparison === 'last-commit') {
        const parent = await readGitOutput(['rev-parse', '--verify', 'HEAD^1'], cwd, timeout)
        return parent.success && parent.stdout?.trim()
            ? ['diff', '--no-ext-diff', '--find-renames', '--binary', parent.stdout.trim(), 'HEAD', '--']
            : ['show', '--format=', '--no-ext-diff', '--find-renames', '--binary', 'HEAD', '--']
    }

    const base = await resolveDefaultBaseRef(cwd, timeout)
    if (!base) return rpcError('Default branch unavailable: origin/HEAD is not configured')
    const verifiedBase = await readGitOutput(
        ['rev-parse', '--verify', '--end-of-options', `${base.ref}^{commit}`],
        cwd,
        timeout
    )
    const verifiedBaseSha = verifiedBase.success ? verifiedBase.stdout?.trim() : ''
    if (!verifiedBaseSha) return rpcError(`Base branch '${base.ref}' is unavailable`)
    const mergeBase = await readGitOutput(['merge-base', verifiedBaseSha, 'HEAD'], cwd, timeout)
    const mergeBaseSha = mergeBase.success ? mergeBase.stdout?.trim() : ''
    if (!mergeBaseSha) return rpcError(`No merge base found for '${base.ref}' and HEAD`)
    return ['diff', '--no-ext-diff', '--find-renames', '--binary', mergeBaseSha, 'HEAD', '--']
}

async function getFullGitDiff(data: GitDiffRequest, cwd: string): Promise<GitCommandResponse> {
    if (data.comparison) {
        const args = await getComparisonDiffArgs(data.comparison, cwd, data.timeout)
        return Array.isArray(args) ? await runGitCommand(args, cwd, data.timeout) : args
    }

    const head = await readGitOutput(['rev-parse', '--verify', 'HEAD'], cwd, data.timeout)
    const trackedResults = head.success && head.stdout?.trim()
        ? [await runGitCommand(['diff', '--no-ext-diff', '--find-renames', '--binary', 'HEAD', '--'], cwd, data.timeout)]
        : await Promise.all([
            runGitCommand(['diff', '--cached', '--no-ext-diff', '--find-renames', '--binary', '--'], cwd, data.timeout),
            runGitCommand(['diff', '--no-ext-diff', '--find-renames', '--binary', '--'], cwd, data.timeout)
        ])
    const trackedFailure = trackedResults.find((result) => !result.success)
    if (trackedFailure) return trackedFailure

    const untracked = await runGitCommand(['ls-files', '--others', '--exclude-standard', '-z'], cwd, data.timeout)
    if (!untracked.success) return untracked
    const nullDevice = process.platform === 'win32' ? 'NUL' : '/dev/null'
    const untrackedPatches: string[] = []
    let outputBytes = trackedResults.reduce(
        (total, result) => total + Buffer.byteLength(result.stdout ?? ''),
        0
    )
    for (const path of splitNullTerminated(untracked.stdout ?? '')) {
        const patch = await runGitCommand(
            ['diff', '--no-index', '--no-ext-diff', '--binary', '--', nullDevice, path],
            cwd,
            data.timeout,
            [0, 1]
        )
        if (!patch.success) return patch
        if (patch.stdout) {
            outputBytes += Buffer.byteLength(patch.stdout)
            if (outputBytes > MAX_GIT_OUTPUT_BYTES) {
                return rpcError('Full diff is too large to display')
            }
            untrackedPatches.push(patch.stdout)
        }
    }

    return {
        success: true,
        stdout: [...trackedResults.map((result) => result.stdout ?? ''), ...untrackedPatches]
            .filter(Boolean)
            .join('\n'),
        stderr: '',
        exitCode: 0
    }
}

type GitNameStatusEntry = Pick<GitComparisonFile, 'path' | 'oldPath' | 'status'>
type GitNumstatEntry = Pick<GitComparisonFile, 'path' | 'linesAdded' | 'linesRemoved' | 'binary'>

function splitNullTerminated(output: string): string[] {
    const fields = output.split('\0')
    if (fields.at(-1) === '') fields.pop()
    return fields
}

export function parseGitNameStatus(output: string): GitNameStatusEntry[] {
    const fields = splitNullTerminated(output)
    const entries: GitNameStatusEntry[] = []

    for (let index = 0; index < fields.length;) {
        const rawStatus = fields[index++] ?? ''
        const code = rawStatus[0]
        const renamed = code === 'R' || code === 'C'
        const oldPath = renamed ? fields[index++] : undefined
        const path = fields[index++]
        if (!path) continue

        const status: GitComparisonFile['status'] = code === 'A' || code === 'C'
            ? 'added'
            : code === 'D'
                ? 'deleted'
                : code === 'R'
                    ? 'renamed'
                    : 'modified'
        entries.push({ path, ...(oldPath ? { oldPath } : {}), status })
    }

    return entries
}

export function parseGitNumstat(output: string): GitNumstatEntry[] {
    const fields = splitNullTerminated(output)
    const entries: GitNumstatEntry[] = []

    for (let index = 0; index < fields.length;) {
        const header = fields[index++] ?? ''
        const [addedRaw = '0', removedRaw = '0', ...pathParts] = header.split('\t')
        let path = pathParts.join('\t')
        if (!path) {
            index += 1 // old path for a rename/copy
            path = fields[index++] ?? ''
        }
        if (!path) continue

        const binary = addedRaw === '-' || removedRaw === '-'
        entries.push({
            path,
            linesAdded: binary ? 0 : Number.parseInt(addedRaw, 10) || 0,
            linesRemoved: binary ? 0 : Number.parseInt(removedRaw, 10) || 0,
            ...(binary ? { binary: true } : {})
        })
    }

    return entries
}

function mergeComparisonFiles(nameStatus: string, numstat: string): GitComparisonFile[] {
    const stats = new Map(parseGitNumstat(numstat).map((entry) => [entry.path, entry]))
    return parseGitNameStatus(nameStatus).map((entry) => {
        const stat = stats.get(entry.path)
        return {
            ...entry,
            linesAdded: stat?.linesAdded ?? 0,
            linesRemoved: stat?.linesRemoved ?? 0,
            ...(stat?.binary ? { binary: true } : {})
        }
    })
}

async function readGitOutput(args: string[], cwd: string, timeout?: number): Promise<GitCommandResponse> {
    return await runGitCommand(args, cwd, timeout)
}

async function resolveDefaultBaseRef(
    cwd: string,
    timeout?: number
): Promise<{ ref: string; label: string } | null> {
    const configured = await readGitOutput(['config', '--get', 'hapi.baseBranch'], cwd, timeout)
    const configuredRef = configured.success ? configured.stdout?.trim() : ''
    if (configuredRef) return { ref: configuredRef, label: configuredRef }

    const upstream = await readGitOutput(
        ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'],
        cwd,
        timeout
    )
    const upstreamRef = upstream.success ? upstream.stdout?.trim() : ''
    const remote = upstreamRef?.includes('/') ? upstreamRef.slice(0, upstreamRef.indexOf('/')) : 'origin'
    const remoteHead = await readGitOutput(
        ['symbolic-ref', '--quiet', '--short', `refs/remotes/${remote}/HEAD`],
        cwd,
        timeout
    )
    const ref = remoteHead.success ? remoteHead.stdout?.trim() : ''
    if (!ref) return null
    return { ref, label: ref.startsWith(`${remote}/`) ? ref.slice(remote.length + 1) : ref }
}

async function gitComparison(
    scope: GitComparisonScope,
    cwd: string,
    timeout?: number
): Promise<GitComparisonResponse> {
    const head = await readGitOutput(['rev-parse', '--verify', 'HEAD'], cwd, timeout)
    const headSha = head.success ? head.stdout?.trim() : ''
    if (!headSha) {
        return { success: false, scope, error: head.error ?? head.stderr ?? 'Repository has no commits' }
    }

    const [branchResult, subjectResult] = await Promise.all([
        readGitOutput(['symbolic-ref', '--quiet', '--short', 'HEAD'], cwd, timeout),
        readGitOutput(['log', '-1', '--format=%s', 'HEAD'], cwd, timeout)
    ])
    const branch = branchResult.success ? branchResult.stdout?.trim() || null : null
    const headSubject = subjectResult.success ? subjectResult.stdout?.trim() ?? '' : ''

    let diffPrefix: string[]
    let baseRef: string | null = null
    let baseBranch: string | null = null
    let commitCount = 1

    if (scope === 'last-commit') {
        const parent = await readGitOutput(['rev-parse', '--verify', 'HEAD^1'], cwd, timeout)
        const parentSha = parent.success ? parent.stdout?.trim() : ''
        diffPrefix = parentSha
            ? ['diff', '--no-ext-diff', '--find-renames', parentSha, headSha]
            : ['diff-tree', '--root', '--no-commit-id', '-r', '--no-ext-diff', '--find-renames', headSha]
    } else {
        const base = await resolveDefaultBaseRef(cwd, timeout)
        if (!base) {
            return {
                success: false,
                scope,
                branch,
                headSha,
                headSubject,
                error: 'Default branch unavailable: origin/HEAD is not configured'
            }
        }
        baseRef = base.ref
        baseBranch = base.label
        const verifiedBase = await readGitOutput(['rev-parse', '--verify', '--end-of-options', `${base.ref}^{commit}`], cwd, timeout)
        const verifiedBaseSha = verifiedBase.success ? verifiedBase.stdout?.trim() : ''
        if (!verifiedBaseSha) {
            return {
                success: false,
                scope,
                branch,
                baseRef,
                baseBranch,
                headSha,
                headSubject,
                error: `Base branch '${base.ref}' is unavailable`
            }
        }
        const mergeBase = await readGitOutput(['merge-base', verifiedBaseSha, headSha], cwd, timeout)
        const mergeBaseSha = mergeBase.success ? mergeBase.stdout?.trim() : ''
        if (!mergeBaseSha) {
            return {
                success: false,
                scope,
                branch,
                baseRef,
                baseBranch,
                headSha,
                headSubject,
                error: `No merge base found for '${base.ref}' and HEAD`
            }
        }
        const count = await readGitOutput(['rev-list', '--count', `${mergeBaseSha}..${headSha}`], cwd, timeout)
        commitCount = count.success ? Number.parseInt(count.stdout?.trim() ?? '', 10) || 0 : 0
        diffPrefix = ['diff', '--no-ext-diff', '--find-renames', mergeBaseSha, headSha]
    }

    const [nameStatus, numstat] = await Promise.all([
        readGitOutput([...diffPrefix, '--name-status', '-z', '--'], cwd, timeout),
        readGitOutput([...diffPrefix, '--numstat', '-z', '--'], cwd, timeout)
    ])
    if (!nameStatus.success || !numstat.success) {
        const failed = !nameStatus.success ? nameStatus : numstat
        return {
            success: false,
            scope,
            branch,
            baseRef,
            baseBranch,
            headSha,
            headSubject,
            commitCount,
            error: failed.error ?? failed.stderr ?? 'Failed to compare Git revisions'
        }
    }

    return {
        success: true,
        scope,
        branch,
        baseRef,
        baseBranch,
        headSha,
        headSubject,
        commitCount,
        files: mergeComparisonFiles(nameStatus.stdout ?? '', numstat.stdout ?? '')
    }
}

export function registerGitHandlers(rpcHandlerManager: RpcHandlerManager, workingDirectory: string): void {
    rpcHandlerManager.registerHandler<GitStatusRequest, GitStatusResponse>(RPC_METHODS.GitStatus, async (data) => {
        const resolved = resolveCwd(data.cwd, workingDirectory)
        if (resolved.error) {
            return rpcError(resolved.error)
        }
        const status = await runGitCommand(
            ['status', '--porcelain=v2', '--branch', '--untracked-files=all'],
            resolved.cwd,
            data.timeout
        )
        if (!status.success) return status

        const branch = currentBranchFromStatus(status.stdout ?? '')
        if (!branch) return status

        const remote = await runGitCommand(['remote', 'get-url', 'origin'], resolved.cwd, data.timeout)
        const createMergeRequestUrl = remote.success
            ? buildGitLabCreateMergeRequestUrl(remote.stdout ?? '', branch)
            : null
        return {
            ...status,
            ...(createMergeRequestUrl ? { createMergeRequestUrl } : {})
        }
    })

    rpcHandlerManager.registerHandler<GitComparisonRequest, GitComparisonResponse>(RPC_METHODS.GitComparison, async (data) => {
        const resolved = resolveCwd(data.cwd, workingDirectory)
        if (resolved.error) {
            return { success: false, scope: data.scope, error: resolved.error }
        }
        if (data.scope !== 'last-commit' && data.scope !== 'branch') {
            return { success: false, scope: data.scope, error: 'Invalid Git comparison scope' }
        }
        return await gitComparison(data.scope, resolved.cwd, data.timeout)
    })

    rpcHandlerManager.registerHandler<GitDiffNumstatRequest, GitCommandResponse>(RPC_METHODS.GitDiffNumstat, async (data) => {
        const resolved = resolveCwd(data.cwd, workingDirectory)
        if (resolved.error) {
            return rpcError(resolved.error)
        }
        const args = data.staged
            ? ['diff', '--cached', '--numstat']
            : ['diff', '--numstat']
        return await runGitCommand(args, resolved.cwd, data.timeout)
    })

    rpcHandlerManager.registerHandler<GitDiffRequest, GitCommandResponse>(RPC_METHODS.GitDiff, async (data) => {
        const resolved = resolveCwd(data.cwd, workingDirectory)
        if (resolved.error) return rpcError(resolved.error)
        if (data.comparison !== undefined && data.comparison !== 'last-commit' && data.comparison !== 'branch') {
            return rpcError('Invalid Git comparison scope')
        }
        return await getFullGitDiff(data, resolved.cwd)
    })

    rpcHandlerManager.registerHandler<GitDiffFileRequest, GitCommandResponse>(RPC_METHODS.GitDiffFile, async (data) => {
        const resolved = resolveCwd(data.cwd, workingDirectory)
        if (resolved.error) {
            return rpcError(resolved.error)
        }
        const fileError = validateFilePath(data.filePath, workingDirectory)
        if (fileError) {
            return rpcError(fileError)
        }
        if (data.comparison !== undefined && data.comparison !== 'last-commit' && data.comparison !== 'branch') {
            return rpcError('Invalid Git comparison scope')
        }

        let args: string[]
        if (data.comparison === 'last-commit') {
            const parent = await readGitOutput(['rev-parse', '--verify', 'HEAD^1'], resolved.cwd, data.timeout)
            args = parent.success && parent.stdout?.trim()
                ? ['diff', '--no-ext-diff', '--find-renames', parent.stdout.trim(), 'HEAD', '--', data.filePath]
                : ['show', '--format=', '--no-ext-diff', '--find-renames', 'HEAD', '--', data.filePath]
        } else if (data.comparison === 'branch') {
            const base = await resolveDefaultBaseRef(resolved.cwd, data.timeout)
            if (!base) return rpcError('Default branch unavailable: origin/HEAD is not configured')
            const verifiedBase = await readGitOutput(
                ['rev-parse', '--verify', '--end-of-options', `${base.ref}^{commit}`],
                resolved.cwd,
                data.timeout
            )
            const verifiedBaseSha = verifiedBase.success ? verifiedBase.stdout?.trim() : ''
            if (!verifiedBaseSha) return rpcError(`Base branch '${base.ref}' is unavailable`)
            const mergeBase = await readGitOutput(['merge-base', verifiedBaseSha, 'HEAD'], resolved.cwd, data.timeout)
            const mergeBaseSha = mergeBase.success ? mergeBase.stdout?.trim() : ''
            if (!mergeBaseSha) return rpcError(`No merge base found for '${base.ref}' and HEAD`)
            args = ['diff', '--no-ext-diff', '--find-renames', mergeBaseSha, 'HEAD', '--', data.filePath]
        } else {
            args = data.staged
                ? ['diff', '--cached', '--no-ext-diff', '--', data.filePath]
                : ['diff', '--no-ext-diff', '--', data.filePath]
        }
        return await runGitCommand(args, resolved.cwd, data.timeout)
    })
}
