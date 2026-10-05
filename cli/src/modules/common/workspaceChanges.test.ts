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

    it('currentStats reports counts without clearing the snapshot', async () => {
        const directory = createRepository()
        const tracker = new WorkspaceChangesTracker()
        expect(tracker.begin(directory)).toBe(true)

        writeFileSync(join(directory, 'new.txt'), 'new\n')
        const stats = await tracker.currentStats(directory)

        expect(stats).toMatchObject({ filesChanged: 1, additions: 1, deletions: 0 })
        expect(stats?.diff).toBeNull()

        // The snapshot survives the read, so the turn's finish() still yields
        // the full diff for the final workspace-changes event.
        expect(tracker.hasSnapshot()).toBe(true)
        const final = tracker.finish(directory)
        expect(final?.diff).toContain('diff --git a/new.txt b/new.txt')
    })

    it('currentStats returns null when nothing is tracked or nothing changed', async () => {
        const directory = createRepository()
        const tracker = new WorkspaceChangesTracker()

        expect(await tracker.currentStats(directory)).toBeNull()

        tracker.begin(directory)
        expect(await tracker.currentStats(directory)).toBeNull()

        const plainDirectory = mkdtempSync(join(tmpdir(), 'hapi-workspace-plain-test-'))
        temporaryDirectories.push(plainDirectory)
        expect(await tracker.currentStats(plainDirectory)).toBeNull()
    })

    it('currentFullDiff returns the diff and a zero object for equal trees', async () => {
        const directory = createRepository()
        const tracker = new WorkspaceChangesTracker()
        tracker.begin(directory)

        // Equal trees mid-turn mean the agent reverted its edits — a live
        // zero, not "no snapshot".
        expect(await tracker.currentFullDiff(directory)).toEqual({
            diff: '',
            filesChanged: 0,
            additions: 0,
            deletions: 0
        })

        writeFileSync(join(directory, 'tracked.txt'), 'after\n')
        const full = await tracker.currentFullDiff(directory)
        expect(full?.filesChanged).toBe(1)
        expect(full?.diff).toContain('diff --git a/tracked.txt b/tracked.txt')

        tracker.finish(directory)
        expect(await tracker.currentFullDiff(directory)).toBeNull()
    })
})
