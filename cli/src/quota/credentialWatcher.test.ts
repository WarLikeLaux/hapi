import { mkdtempSync, mkdirSync, rmSync, writeFileSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CredentialWatcher, defaultCredentialWatchDirs } from './credentialWatcher'

const dirs: string[] = []

function tempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'hapi-credential-watcher-'))
    dirs.push(dir)
    return dir
}

afterEach(() => {
    for (const dir of dirs.splice(0)) {
        rmSync(dir, { recursive: true, force: true })
    }
})

describe('defaultCredentialWatchDirs', () => {
    it('returns the MiniMax auth subtree and the platform cursor dir', () => {
        const linux = defaultCredentialWatchDirs('/h', 'linux')
        expect(linux).toEqual([
            join('/h', '.minimax', 'auth'),
            join('/h', '.config', 'cursor')
        ])

        const mac = defaultCredentialWatchDirs('/h', 'darwin')
        expect(mac).toEqual([
            join('/h', '.minimax', 'auth'),
            join('/h', 'Library', 'Application Support', 'Cursor')
        ])

        const win = defaultCredentialWatchDirs('/h', 'win32')
        expect(win).toEqual([
            join('/h', '.minimax', 'auth'),
            join('/h', 'AppData', 'Roaming', 'Cursor')
        ])
    })

    it('returns an empty list when HOME is unknown', () => {
        expect(defaultCredentialWatchDirs('', 'linux')).toEqual([])
    })
})

describe('CredentialWatcher', () => {
    function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
        let resolve!: (value: T) => void
        const promise = new Promise<T>((res) => {
            resolve = res
        })
        return { promise, resolve }
    }

    async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
        const start = Date.now()
        while (!predicate()) {
            if (Date.now() - start > timeoutMs) throw new Error('waitFor: timed out')
            await new Promise((resolve) => setTimeout(resolve, 10))
        }
    }

    it('fires onChange when a nested auth.json is rewritten', async () => {
        const root = tempDir()
        const authDir = join(root, 'auth', 'prod', 'en', 'mcode-public')
        mkdirSync(authDir, { recursive: true })
        const authFile = join(authDir, 'auth.json')
        writeFileSync(authFile, JSON.stringify({ accessToken: 'v1' }))

        const calls: number[] = []
        const watcher = new CredentialWatcher(() => {
            calls.push(Date.now())
        }, { debounceMs: 20 })
        watcher.watchPaths([root])

        // mcode rewrites auth.json atomically: writes a tmp file then renames it.
        const tmp = `${authFile}.${process.pid}.tmp`
        writeFileSync(tmp, JSON.stringify({ accessToken: 'v2' }))
        const { renameSync } = await import('node:fs')
        renameSync(tmp, authFile)

        await waitFor(() => calls.length > 0)
        watcher.stop()
        expect(calls.length).toBeGreaterThan(0)
    })

    it('debounces a burst of events into one callback', async () => {
        const root = tempDir()
        const authDir = join(root, 'auth', 'prod', 'en', 'mcode-public')
        mkdirSync(authDir, { recursive: true })
        const authFile = join(authDir, 'auth.json')
        writeFileSync(authFile, JSON.stringify({ accessToken: 'v1' }))

        const calls: number[] = []
        const watcher = new CredentialWatcher(() => {
            calls.push(Date.now())
        }, { debounceMs: 80 })
        watcher.watchPaths([root])

        // Simulate the rename+change pair Linux inotify typically emits.
        for (let i = 0; i < 5; i++) {
            utimesSync(authFile, new Date(), new Date())
        }

        // Wait for the debounced callback to settle.
        await new Promise((resolve) => setTimeout(resolve, 200))
        watcher.stop()
        expect(calls).toHaveLength(1)
    })

    it('retries watching a missing path and fires once it appears', async () => {
        const root = tempDir()
        const lateDir = join(root, 'late')
        // lateDir does not exist yet — matches a fresh mcode install.

        const calls: number[] = []
        const watcher = new CredentialWatcher(() => {
            calls.push(Date.now())
        }, { debounceMs: 10, missingPathGraceMs: 50 })
        watcher.watchPaths([lateDir])

        expect(calls).toHaveLength(0)

        // Create the directory and an auth.json inside it; wait past the
        // grace window so the retry timer fires and re-arms the watcher.
        mkdirSync(lateDir, { recursive: true })
        const authFile = join(lateDir, 'auth.json')
        writeFileSync(authFile, JSON.stringify({ accessToken: 'first' }))
        await new Promise((resolve) => setTimeout(resolve, 120))

        // Now mutate the file: the freshly armed watcher should pick it up.
        writeFileSync(authFile, JSON.stringify({ accessToken: 'second' }))
        await waitFor(() => calls.length > 0)
        watcher.stop()
        expect(calls.length).toBeGreaterThan(0)
    })

    it('stop() detaches every watcher and clears pending timers', async () => {
        const root = tempDir()
        const authDir = join(root, 'auth', 'prod', 'en', 'mcode-public')
        mkdirSync(authDir, { recursive: true })
        const authFile = join(authDir, 'auth.json')
        writeFileSync(authFile, JSON.stringify({ accessToken: 'v1' }))

        const fired = deferred<void>()
        const calls: number[] = []
        const watcher = new CredentialWatcher(() => {
            calls.push(Date.now())
            if (calls.length === 1) fired.resolve()
        }, { debounceMs: 10 })
        watcher.watchPaths([root])

        writeFileSync(authFile, JSON.stringify({ accessToken: 'v2' }))
        await fired.promise
        watcher.stop()

        // After stop(), further writes must not fire callbacks.
        writeFileSync(authFile, JSON.stringify({ accessToken: 'v3' }))
        await new Promise((resolve) => setTimeout(resolve, 100))
        expect(calls).toHaveLength(1)
    })
})
