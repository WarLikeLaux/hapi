import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { GitComparisonResponse } from '@hapi/protocol/apiTypes'
import { RPC_METHODS } from '@hapi/protocol/rpcMethods'
import { buildGitLabCreateMergeRequestUrl, parseGitNameStatus, parseGitNumstat, registerGitHandlers } from './git'

const temporaryDirectories: string[] = []

function git(cwd: string, ...args: string[]): string {
    return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

async function createRepository(initialBranch = 'develop'): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), 'hapi-git-handler-'))
    temporaryDirectories.push(directory)
    git(directory, 'init', '-b', initialBranch)
    git(directory, 'config', 'user.email', 'hapi@example.com')
    git(directory, 'config', 'user.name', 'HAPI Test')
    git(directory, 'config', 'commit.gpgsign', 'false')
    return directory
}

function gitHandlers(directory: string) {
    const handlers = new Map<string, (payload: any) => Promise<any>>()
    registerGitHandlers({
        registerHandler: (method: string, handler: (payload: any) => Promise<any>) => handlers.set(method, handler)
    } as never, directory)
    return handlers
}

function comparisonHandler(directory: string) {
    return gitHandlers(directory).get(RPC_METHODS.GitComparison)! as (payload: unknown) => Promise<GitComparisonResponse>
}

afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('Git comparison parsing', () => {
    it('parses null-delimited renames and binary numstat', () => {
        expect(parseGitNameStatus('R100\0old name.txt\0new name.txt\0M\0image.png\0')).toEqual([
            { path: 'new name.txt', oldPath: 'old name.txt', status: 'renamed' },
            { path: 'image.png', status: 'modified' }
        ])
        expect(parseGitNumstat('3\t1\t\0old name.txt\0new name.txt\0-\t-\timage.png\0')).toEqual([
            { path: 'new name.txt', linesAdded: 3, linesRemoved: 1 },
            { path: 'image.png', linesAdded: 0, linesRemoved: 0, binary: true }
        ])
    })
})

describe('GitLab merge request links', () => {
    it('builds credential-free create links for HTTPS and SSH remotes', () => {
        expect(buildGitLabCreateMergeRequestUrl(
            'https://oauth2:secret@gitlab.example.test/group/project.git',
            'feature/review'
        )).toBe(
            'https://gitlab.example.test/group/project/-/merge_requests/new?merge_request%5Bsource_branch%5D=feature%2Freview'
        )
        expect(buildGitLabCreateMergeRequestUrl(
            'git@gitlab.example.test:group/subgroup/project.git',
            'feature/review'
        )).toBe(
            'https://gitlab.example.test/group/subgroup/project/-/merge_requests/new?merge_request%5Bsource_branch%5D=feature%2Freview'
        )
    })

    it('does not offer GitHub or local-path remotes as GitLab links', () => {
        expect(buildGitLabCreateMergeRequestUrl('git@github.com:owner/project.git', 'feature')).toBeNull()
        expect(buildGitLabCreateMergeRequestUrl('/tmp/project.git', 'feature')).toBeNull()
    })

    it('adds the current branch create link to Git status', async () => {
        const directory = await createRepository('feature/review')
        git(directory, 'remote', 'add', 'origin', 'git@gitlab.example.test:group/project.git')

        const result = await gitHandlers(directory).get(RPC_METHODS.GitStatus)!({})

        expect(result).toMatchObject({
            success: true,
            createMergeRequestUrl: 'https://gitlab.example.test/group/project/-/merge_requests/new?merge_request%5Bsource_branch%5D=feature%2Freview'
        })
    })
})

describe('Git comparison handler', () => {
    it('renders one working-tree diff including staged, unstaged, and untracked files', async () => {
        const directory = await createRepository()
        await writeFile(join(directory, 'tracked.txt'), 'base\n')
        git(directory, 'add', 'tracked.txt')
        git(directory, 'commit', '-m', 'Base')
        await writeFile(join(directory, 'tracked.txt'), 'base\nstaged\n')
        git(directory, 'add', 'tracked.txt')
        await writeFile(join(directory, 'tracked.txt'), 'base\nstaged\nunstaged\n')
        await writeFile(join(directory, 'untracked.txt'), 'new file\n')

        const result = await gitHandlers(directory).get(RPC_METHODS.GitDiff)!({})

        expect(result).toMatchObject({ success: true })
        expect(result.stdout).toContain('+staged')
        expect(result.stdout).toContain('+unstaged')
        expect(result.stdout).toContain('untracked.txt')
        expect(result.stdout).toContain('+new file')
    })

    it('compares the current branch with the remote default branch merge base', async () => {
        const directory = await createRepository()
        await writeFile(join(directory, 'base.txt'), 'base\n')
        git(directory, 'add', 'base.txt')
        git(directory, 'commit', '-m', 'Base')
        git(directory, 'update-ref', 'refs/remotes/origin/develop', 'HEAD')
        git(directory, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/develop')
        git(directory, 'switch', '-c', 'feature')
        await writeFile(join(directory, 'feature.txt'), 'one\ntwo\n')
        git(directory, 'add', 'feature.txt')
        git(directory, 'commit', '-m', 'Add feature')

        const result = await comparisonHandler(directory)({ scope: 'branch' })

        expect(result).toMatchObject({
            success: true,
            scope: 'branch',
            branch: 'feature',
            baseRef: 'origin/develop',
            baseBranch: 'develop',
            headSubject: 'Add feature',
            commitCount: 1,
            files: [{ path: 'feature.txt', status: 'added', linesAdded: 2, linesRemoved: 0 }]
        })

        const diffHandler = gitHandlers(directory).get(RPC_METHODS.GitDiffFile)!
        const fullDiffHandler = gitHandlers(directory).get(RPC_METHODS.GitDiff)!
        const branchDiff = await diffHandler({ filePath: 'feature.txt', comparison: 'branch' })
        const lastCommitDiff = await diffHandler({ filePath: 'feature.txt', comparison: 'last-commit' })
        const fullBranchDiff = await fullDiffHandler({ comparison: 'branch' })

        expect(branchDiff).toMatchObject({ success: true })
        expect(branchDiff.stdout).toContain('+one')
        expect(branchDiff.stdout).toContain('+two')
        expect(lastCommitDiff).toMatchObject({ success: true })
        expect(lastCommitDiff.stdout).toContain('+one')
        expect(lastCommitDiff.stdout).toContain('+two')
        expect(fullBranchDiff.stdout).toContain('feature.txt')
        expect(fullBranchDiff.stdout).toContain('+two')
    })

    it('shows a root commit and compares a merge commit with its first parent', async () => {
        const directory = await createRepository()
        await writeFile(join(directory, 'root.txt'), 'root\n')
        git(directory, 'add', 'root.txt')
        git(directory, 'commit', '-m', 'Root commit')
        const handler = comparisonHandler(directory)

        expect(await handler({ scope: 'last-commit' })).toMatchObject({
            success: true,
            headSubject: 'Root commit',
            files: [{ path: 'root.txt', status: 'added', linesAdded: 1, linesRemoved: 0 }]
        })

        git(directory, 'switch', '-c', 'side')
        await writeFile(join(directory, 'side.txt'), 'side\n')
        git(directory, 'add', 'side.txt')
        git(directory, 'commit', '-m', 'Side change')
        git(directory, 'switch', 'develop')
        await writeFile(join(directory, 'main.txt'), 'main\n')
        git(directory, 'add', 'main.txt')
        git(directory, 'commit', '-m', 'Main change')
        git(directory, 'merge', '--no-ff', 'side', '-m', 'Merge side')

        expect(await handler({ scope: 'last-commit' })).toMatchObject({
            success: true,
            headSubject: 'Merge side',
            files: [{ path: 'side.txt', status: 'added', linesAdded: 1, linesRemoved: 0 }]
        })
    })

    it('returns a useful error when the remote default branch is unavailable', async () => {
        const directory = await createRepository('main')
        await writeFile(join(directory, 'README.md'), 'hello\n')
        git(directory, 'add', 'README.md')
        git(directory, 'commit', '-m', 'Initial')

        expect(await comparisonHandler(directory)({ scope: 'branch' })).toMatchObject({
            success: false,
            error: 'Default branch unavailable: origin/HEAD is not configured'
        })
    })
})
