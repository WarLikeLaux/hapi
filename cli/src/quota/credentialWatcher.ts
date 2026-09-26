import { existsSync, watch, type FSWatcher } from 'node:fs'
import { join } from 'node:path'

const DEFAULT_DEBOUNCE_MS = 500
/**
 * How long the auth path can be missing before we give up retrying to watch it.
 * mcode creates the auth directory lazily on first login, so a fresh install
 * can boot without the path in place; this guards the watcher from throwing
 * on every restart while still re-arming once the directory appears.
 */
const MISSING_PATH_GRACE_MS = 60_000

/**
 * Directories whose contents trigger a quota re-poll when they change. Each
 * path is watched recursively (Node 20+ on macOS/Windows, Node 22+ on Linux);
 * missing paths are retried for {@link MISSING_PATH_GRACE_MS} then dropped
 * silently — the periodic 5-minute poll is the safety net.
 *
 * The MiniMax subtree covers every region's `auth.json` because mcode picks
 * the region from `preferences/mcode-region.json` at runtime. The Cursor
 * directory is the platform-specific location the cursor CLI writes its
 * `auth.json` to.
 */
export function defaultCredentialWatchDirs(
    home: string = process.env.HOME ?? '',
    platform: NodeJS.Platform = process.platform
): string[] {
    if (!home) return []
    const dirs: string[] = [join(home, '.minimax', 'auth')]
    switch (platform) {
        case 'darwin':
            dirs.push(join(home, 'Library', 'Application Support', 'Cursor'))
            break
        case 'win32':
            dirs.push(join(process.env.APPDATA ?? join(home, 'AppData', 'Roaming'), 'Cursor'))
            break
        default:
            dirs.push(join(home, '.config', 'cursor'))
            break
    }
    return dirs
}

/**
 * Watches the credential files quota collectors read from, so a token refresh
 * on disk (mcode's silent refresh, a manual `mcode login`, etc.) is picked up
 * before the next periodic poll fires. Without this, the UI would lag up to
 * one full poll interval behind the underlying token state.
 */
export class CredentialWatcher {
    private watchers: FSWatcher[] = []
    private missingRetries = new Map<string, NodeJS.Timeout>()
    private debounceTimer: NodeJS.Timeout | null = null

    constructor(
        private readonly onChange: () => void,
        private readonly options: { debounceMs?: number; missingPathGraceMs?: number } = {}
    ) {}

    /**
     * Set up watchers on the given directories. Missing directories are
     * re-tried for {@link MISSING_PATH_GRACE_MS}; existing directories are
     * watched recursively so nested files (e.g. `prod/en/mcode-public/auth.json`)
     * are caught without enumerating every level at startup.
     */
    watchPaths(paths: readonly string[]): void {
        this.stop()
        for (const path of paths) {
            this.armPath(path)
        }
    }

    stop(): void {
        for (const watcher of this.watchers) {
            try {
                watcher.close()
            } catch {
                // Best effort: a closed watcher must not throw on teardown.
            }
        }
        this.watchers = []
        for (const timer of this.missingRetries.values()) {
            clearTimeout(timer)
        }
        this.missingRetries.clear()
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer)
            this.debounceTimer = null
        }
    }

    private armPath(path: string): void {
        if (!existsSync(path)) {
            this.scheduleMissingRetry(path)
            return
        }
        try {
            const watcher = watch(path, { recursive: true }, () => this.scheduleNotify())
            watcher.unref?.()
            this.watchers.push(watcher)
        } catch {
            // Some filesystems reject recursive watches; treat the path as
            // missing and let the grace timer retry. The next connect/reconnect
            // will try again.
            this.scheduleMissingRetry(path)
        }
    }

    private scheduleMissingRetry(path: string): void {
        if (this.missingRetries.has(path)) return
        const grace = this.options.missingPathGraceMs ?? MISSING_PATH_GRACE_MS
        const timer = setTimeout(() => {
            this.missingRetries.delete(path)
            this.armPath(path)
        }, grace)
        timer.unref?.()
        this.missingRetries.set(path, timer)
    }

    private scheduleNotify(): void {
        if (this.debounceTimer) return
        const debounceMs = this.options.debounceMs ?? DEFAULT_DEBOUNCE_MS
        // Coalesce a burst of inotify events (rename + change typically fire
        // in pairs on Linux) into a single callback. The first event schedules
        // the fire; subsequent events inside the window are dropped.
        this.debounceTimer = setTimeout(() => {
            this.debounceTimer = null
            try {
                this.onChange()
            } catch {
                // The reporter must never throw out of a watcher callback.
            }
        }, debounceMs)
        this.debounceTimer.unref?.()
    }
}
