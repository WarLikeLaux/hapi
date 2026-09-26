import { readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { logger } from '@/ui/logger';

export type MinimaxSessionLocator = {
    /** Resolves once the pre-launch snapshot exists — safe to spawn mcode. */
    ready: Promise<void>;
    cleanup: () => Promise<void>;
};

const SESSIONS_ROOT = join(homedir(), '.minimax', 'v2', 'sessions');
const SCAN_INTERVAL_MS = 2000;
const LOCATE_TIMEOUT_MS = 10 * 60_000;

function listManifestPaths(): string[] {
    const manifests: string[] = [];
    const walk = (dir: string, depth: number) => {
        if (depth > 5) return;
        let entries;
        try {
            entries = readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            if (entry.name.startsWith('.')) continue;
            const full = join(dir, entry.name);
            if (entry.isDirectory()) {
                walk(full, depth + 1);
            } else if (entry.name === 'manifest.json') {
                manifests.push(full);
            }
        }
    };
    walk(SESSIONS_ROOT, 0);
    return manifests;
}

function readManifestSessionId(manifestPath: string): string | null {
    try {
        const raw = JSON.parse(readFileSync(manifestPath, 'utf-8'));
        const id = raw?.sessionId;
        return typeof id === 'string' && id.trim() ? id.trim() : null;
    } catch {
        return null;
    }
}

/**
 * Locates the mcode session created by a fresh local TUI launch so the hub
 * row can carry the native id (handoff + later ACP `session/load` resume).
 * Works from the on-disk v2 session store: manifests present before the spawn
 * are a snapshot; the first new manifest appearing after it is the launched
 * session. Two or more new manifests (parallel launches) are ambiguous — sync
 * is disabled rather than guessing, mirroring the Kimi wire locator behavior.
 *
 * This discovery only binds the id. Local conversation mirroring (what the
 * Kimi wire scanner does) is not implemented yet: handoff from the mcode TUI
 * keeps the native session but past local messages are not backfilled.
 */
export function createMinimaxSessionLocator(opts: {
    startupTimestampMs: number;
    resumeSessionId: string | null;
    onLocated: (sessionId: string) => void;
    onAmbiguous: (sessionIds: string[]) => void;
}): MinimaxSessionLocator {
    if (opts.resumeSessionId) {
        // Resuming an existing session — the id is already known and bound.
        return { ready: Promise.resolve(), cleanup: async () => {} };
    }

    let snapshot: Set<string> | null = null;
    let timer: NodeJS.Timeout | null = null;
    let settled = false;

    const stopTimer = () => {
        if (timer) {
            clearInterval(timer);
            timer = null;
        }
    };

    const scan = () => {
        if (settled) {
            stopTimer();
            return;
        }
        if (!snapshot) {
            snapshot = new Set(listManifestPaths());
            return;
        }
        const freshSessionIds: string[] = [];
        for (const manifestPath of listManifestPaths()) {
            if (snapshot.has(manifestPath)) continue;
            try {
                if (statSync(manifestPath).mtimeMs < opts.startupTimestampMs) continue;
            } catch {
                continue;
            }
            const sessionId = readManifestSessionId(manifestPath);
            if (sessionId) {
                freshSessionIds.push(sessionId);
            }
        }
        if (freshSessionIds.length === 1) {
            settled = true;
            stopTimer();
            logger.debug(`[minimax-local]: Located fresh mcode session ${freshSessionIds[0]}`);
            opts.onLocated(freshSessionIds[0]);
        } else if (freshSessionIds.length > 1) {
            settled = true;
            stopTimer();
            logger.warn(`[minimax-local]: Multiple fresh mcode sessions found (${freshSessionIds.join(', ')}); session sync disabled for this launch`);
            opts.onAmbiguous(freshSessionIds);
        } else if (Date.now() - opts.startupTimestampMs > LOCATE_TIMEOUT_MS) {
            settled = true;
            stopTimer();
            logger.debug('[minimax-local]: No fresh mcode session found before timeout');
        }
    };

    timer = setInterval(scan, SCAN_INTERVAL_MS);

    return {
        ready: new Promise<void>((resolve) => {
            setImmediate(() => {
                snapshot = new Set(listManifestPaths());
                resolve();
            });
        }),
        cleanup: async () => {
            settled = true;
            stopTimer();
        }
    };
}
