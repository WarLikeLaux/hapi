import { execFileSync } from 'node:child_process'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
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
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
    await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

async function installGitLabFixture(directory: string) {
    const responsePath = join(directory, 'gitlab-response.json')
    const callsPath = join(directory, 'gitlab-calls.jsonl')
    const executablePath = join(directory, 'glab')
    await writeFile(responsePath, '[]')
    await writeFile(callsPath, '')
    await writeFile(executablePath, `#!${process.execPath}
const fs = require('node:fs');
fs.appendFileSync(${JSON.stringify(callsPath)}, JSON.stringify(process.argv.slice(2)) + '\\n');
const body = fs.readFileSync(${JSON.stringify(responsePath)}, 'utf8');
if (body === 'error') process.exit(1);
process.stdout.write(body);
`)
    await chmod(executablePath, 0o755)
    vi.stubEnv('PATH', `${directory}:${process.env.PATH}`)
    return {
        respond: (body: unknown) => writeFile(responsePath, JSON.stringify(body)),
        fail: () => writeFile(responsePath, 'error'),
        calls: async () => (await readFile(callsPath, 'utf8')).trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)),
    }
}

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
        await installGitLabFixture(directory)
        git(directory, 'remote', 'add', 'origin', 'git@gitlab.example.test:group/project.git')

        const result = await gitHandlers(directory).get(RPC_METHODS.GitStatus)!({})

        expect(result).toMatchObject({
            success: true,
            mergeRequestUrl: null,
            createMergeRequestUrl: 'https://gitlab.example.test/group/project/-/merge_requests/new?merge_request%5Bsource_branch%5D=feature%2Freview'
        })
    })

    it('discovers an open MR, shares cached polls, follows branch changes and refreshes after closure or API failure', async () => {
        const directory = await createRepository('feature/review')
        git(directory, 'remote', 'add', 'origin', 'git@gitlab.example.test:group/project.git')
        const api = await installGitLabFixture(directory)
        const review = {
            state: 'opened', source_branch: 'feature/review', project_id: 1, source_project_id: 1,
            web_url: 'https://gitlab.example.test/group/project/-/merge_requests/7',
        }
        await api.respond([
            { ...review, source_project_id: 2, web_url: 'https://gitlab.example.test/group/project/-/merge_requests/8' },
            review,
        ])
        let now = Date.now()
        vi.spyOn(Date, 'now').mockImplementation(() => now)
        const status = gitHandlers(directory).get(RPC_METHODS.GitStatus)!
        const firstPolls = await Promise.all([status({}), status({})])
        expect(firstPolls.map((result) => result.mergeRequestUrl)).toEqual([review.web_url, review.web_url])
        expect(await api.calls()).toEqual([[
            'api', 'projects/group%2Fproject/merge_requests?state=opened&source_branch=feature%2Freview&scope=all&order_by=updated_at&sort=desc&per_page=100',
            '--hostname', 'gitlab.example.test',
        ]])

        git(directory, 'symbolic-ref', 'HEAD', 'refs/heads/second')
        await api.respond([])
        expect(await status({})).toMatchObject({ success: true, mergeRequestUrl: null })
        expect(await api.calls()).toHaveLength(2)
        await api.respond([{ ...review, source_branch: 'second' }])
        expect((await status({})).mergeRequestUrl).toBeNull()
        now += 60_001
        expect((await status({})).mergeRequestUrl).toBe(review.web_url)

        await api.respond([])
        now += 60_001
        expect((await status({})).mergeRequestUrl).toBeNull()
        await api.fail()
        now += 60_001
        expect(await status({})).toMatchObject({ success: true, mergeRequestUrl: null })
        const callsAfterFailure = (await api.calls()).length
        await status({})
        expect(await api.calls()).toHaveLength(callsAfterFailure)
        await api.respond([{ ...review, source_branch: 'second' }])
        now += 60_001
        expect((await status({})).mergeRequestUrl).toBe(review.web_url)
    })

    it('rejects unsafe or mismatched MR responses and skips discovery for detached HEAD', async () => {
        const directory = await createRepository('feature')
        git(directory, 'remote', 'add', 'origin', 'git@gitlab.example.test:group/project.git')
        const api = await installGitLabFixture(directory)
        await api.respond([
            { state: 'opened', source_branch: 'feature', project_id: 1, source_project_id: 1, web_url: 'https://evil.test/group/project/-/merge_requests/1' },
            { state: 'closed', source_branch: 'feature', project_id: 1, source_project_id: 1, web_url: 'https://gitlab.example.test/group/project/-/merge_requests/2' },
            { state: 'opened', source_branch: 'other', project_id: 1, source_project_id: 1, web_url: 'https://gitlab.example.test/group/project/-/merge_requests/3' },
        ])
        const status = gitHandlers(directory).get(RPC_METHODS.GitStatus)!
        expect((await status({})).mergeRequestUrl).toBeNull()
        await writeFile(join(directory, 'file.txt'), 'base')
        git(directory, 'add', 'file.txt')
        git(directory, 'commit', '-m', 'Base')
        git(directory, 'checkout', '--detach')
        expect(await status({})).toMatchObject({ success: true, mergeRequestUrl: null, createMergeRequestUrl: null })
        expect(await api.calls()).toHaveLength(1)
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
