import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { WorkspaceChangesTracker } from './workspaceChanges'

const temporaryDirectories: string[] = []

function createRepository(): string {
    const directory = mkdtempSync(join(tmpdir(), 'hapi-workspace-changes-test-'))
    temporaryDirectories.push(directory)
    execFileSync('git', ['init', '-q'], { cwd: directory })
    execFileSync('git', ['config', 'user.name', 'HAPI Test'], { cwd: directory })
    execFileSync('git', ['config', 'user.email', 'hapi@example.test'], { cwd: directory })
    writeFileSync(join(directory, 'tracked.txt'), 'before\n')
    execFileSync('git', ['add', 'tracked.txt'], { cwd: directory })
    execFileSync('git', ['commit', '-qm', 'Initial'], { cwd: directory })
    return directory
}

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        rmSync(directory, { recursive: true, force: true })
    }
})

describe('WorkspaceChangesTracker', () => {
    it('captures only net changes made after the turn starts', () => {
        const directory = createRepository()
        writeFileSync(join(directory, 'existing-dirty.txt'), 'already here\n')
        const tracker = new WorkspaceChangesTracker()

        tracker.begin(directory)
        writeFileSync(join(directory, 'tracked.txt'), 'after\n')
        writeFileSync(join(directory, 'new.txt'), 'new\n')

        const changes = tracker.finish(directory)

        expect(changes).toMatchObject({ filesChanged: 2, additions: 2, deletions: 1 })
        expect(changes?.diff).toContain('diff --git a/new.txt b/new.txt')
        expect(changes?.diff).toContain('diff --git a/tracked.txt b/tracked.txt')
        expect(changes?.diff).not.toContain('existing-dirty.txt')
    })

    it('returns no changes when the workspace is unchanged or not a Git repository', () => {
        const directory = createRepository()
        const tracker = new WorkspaceChangesTracker()
        tracker.begin(directory)
        expect(tracker.finish(directory)).toBeNull()

        const plainDirectory = mkdtempSync(join(tmpdir(), 'hapi-workspace-plain-test-'))
        temporaryDirectories.push(plainDirectory)
        tracker.begin(plainDirectory)
        expect(tracker.finish(plainDirectory)).toBeNull()
    })
})
