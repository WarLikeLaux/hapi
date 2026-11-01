import { execFile, spawn } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function readFileUtf8(path: string): Promise<string> {
    return readFile(path, 'utf8');
}

import { AcpSdkBackend } from '@/agent/backends/acp';
import { buildOpencodeEnv } from './config';
import { getInvokedCwd } from '@/utils/invokedCwd';
import { getAgentLaunchCommand } from '@/agent/agentLaunchCommand';

export type OpencodeFlavorVersion = 'v1' | 'v2';

/**
 * Detects whether the installed `opencode` binary speaks the v1 (≤1.x) or
 * v2 (≥2.x) CLI contract. v2 dropped the `opencode acp` `--cwd/--port/
 * --hostname` flags and redesigned the internal HTTP API (see the
 * opencode-v2-compat plan), so the launcher needs the major version before
 * spawning. Runs `command --version` (5s timeout) and parses the first
 * `v?N.` from stdout; any spawn failure, timeout or unparseable output
 * falls back to 'v1' — the pre-v2-aware behavior.
 */
export async function detectOpencodeFlavorVersion(command = getAgentLaunchCommand('opencode')): Promise<'v1' | 'v2'> {
    try {
        const stdout = await new Promise<string>((resolve, reject) => {
            // shell/windowsHide mirror buildAcpStdioSpawnOptions: on Windows,
            // npm-style opencode.cmd shims require a shell to resolve, and a
            // bare spawn would fail the probe and misclassify v2 as v1.
            const child = spawn(command, ['--version'], {
                stdio: ['ignore', 'pipe', 'ignore'],
                shell: process.platform === 'win32',
                windowsHide: process.platform === 'win32'
            });
            let out = '';
            const timer = setTimeout(() => {
                child.kill();
                reject(new Error('opencode --version timed out'));
            }, 5000);
            child.stdout?.on('data', (chunk) => {
                out += String(chunk);
            });
            child.on('error', (error) => {
                clearTimeout(timer);
                reject(error instanceof Error ? error : new Error(String(error)));
            });
            child.on('close', () => {
                clearTimeout(timer);
                resolve(out);
            });
        });
        const match = /v?(\d+)\./.exec(stdout);
        const major = match ? Number.parseInt(match[1]!, 10) : Number.NaN;
        return major === 2 ? 'v2' : 'v1';
    } catch {
        return 'v1';
    }
}

function filterEnv(env: NodeJS.ProcessEnv): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(env)) {
        if (value !== undefined) {
            result[key] = value;
        }
    }
    return result;
}

/**
 * Reserves a free TCP port on the given loopback host by binding an
 * ephemeral probe socket (`listen(0)`) and immediately closing it before
 * resolving. `opencode acp` does not announce the port it actually bound
 * when launched with `--port 0` (verified 2026-07-30 — no port appears in
 * stdout/stderr even at DEBUG log level), so HAPI must pick the port itself
 * and hand it to the subprocess explicitly via `--port`. There is a
 * theoretical reuse race between this function releasing the port and the
 * subprocess binding it, but both sides are loopback-only local processes,
 * so the practical risk is low.
 */
export function allocateFreePort(hostname = '127.0.0.1'): Promise<number> {
    return new Promise((resolve, reject) => {
        const probe = createServer();
        probe.once('error', reject);
        probe.listen(0, hostname, () => {
            const address = probe.address();
            const port = address && typeof address === 'object' ? address.port : null;
            probe.close((closeError) => {
                if (closeError) {
                    reject(closeError);
                    return;
                }
                if (port === null) {
                    reject(new Error('Failed to allocate a free port for the OpenCode ACP server'));
                    return;
                }
                resolve(port);
            });
        });
    });
}

export function createOpencodeBackend(opts: {
    cwd?: string;
    port?: number;
    hostname?: string;
    majorVersion?: 'v1' | 'v2';
}): AcpSdkBackend {
    const env = buildOpencodeEnv();
    if (opts.majorVersion === 'v2') {
        // opencode v2 rejects `acp --cwd/--port/--hostname` ("Unrecognized
        // flag"); the working directory is taken from the spawn cwd instead,
        // and the internal HTTP API port is bound randomly (post-discovered).
        return new AcpSdkBackend({
            command: getAgentLaunchCommand('opencode'),
            args: ['acp'],
            env: filterEnv(env),
            spawnCwd: opts.cwd ?? getInvokedCwd(),
            acpModelSwitchViaConfigOption: true,
            childSessionUpdates: true,
            textChunkMode: 'delta',
            flavor: 'opencode',
        });
    }
    const args = ['acp', '--cwd', opts.cwd ?? getInvokedCwd()];
    if (opts.port !== undefined) {
        args.push('--port', String(opts.port));
    }
    if (opts.hostname !== undefined) {
        args.push('--hostname', opts.hostname);
    }

    return new AcpSdkBackend({
        command: getAgentLaunchCommand('opencode'),
        args,
        env: filterEnv(env),
        textChunkMode: 'delta',
        flavor: 'opencode',
    });
}


/**
 * Parses `ss -tln` output and returns the set of ports bound to 127.0.0.1.
 * Accepts the real header row and arbitrary column spacing; non-loopback
 * (0.0.0.0, [::1], [::]) listeners are excluded.
 */
export function parseSsListeners(output: string): Set<number> {
    const ports = new Set<number>();
    for (const line of output.split('\n')) {
        if (!/\bLISTEN\b/.test(line)) continue;
        const match = /127\.0\.0\.1:(\d+)/.exec(line);
        if (match) {
            ports.add(Number.parseInt(match[1]!, 10));
        }
    }
    return ports;
}

/**
 * Parses `lsof -iTCP -sTCP:LISTEN -n -P` output (macOS fallback) and returns
 * the set of ports bound to 127.0.0.1.
 */
export function parseLsofListeners(output: string): Set<number> {
    const ports = new Set<number>();
    for (const line of output.split('\n')) {
        const match = /127\.0\.0\.1:(\d+)/.exec(line);
        if (match) {
            ports.add(Number.parseInt(match[1]!, 10));
        }
    }
    return ports;
}

/**
 * Lists the child pids of the given process. Linux reads the per-task
 * `children` files under `/proc/<pid>/task/` (NUL/space-separated); darwin
 * shells out to `pgrep -P`. Any failure (process gone, tool missing,
 * unparsable output) yields an empty array — callers treat that as "no
 * children known", never as an error.
 */
export async function listChildPids(pid: number, opts?: {
    platform?: NodeJS.Platform;
    readChildrenFile?: (pid: number, task: string) => Promise<string>;
    execImpl?: (command: string, args: string[]) => Promise<string>;
    maxDepth?: number;
}): Promise<number[]> {
    const platform = opts?.platform ?? process.platform;
    const maxDepth = opts?.maxDepth ?? 4;
    try {
        if (platform === 'linux') {
            const readChildren = opts?.readChildrenFile ?? (async (p: number, task: string) =>
                await readFileUtf8(`/proc/${p}/task/${task}/children`));
            const tasks = await readdir(`/proc/${pid}/task`);
            // Union children across ALL tasks: threads can each hold a
            // different child (e.g. a helper forked from one task and the
            // serve child from another) — stopping at the first nonempty
            // task would drop the rest.
            const union = new Set<number>();
            const direct: number[] = [];
            for (const task of tasks) {
                try {
                    const children = await readChildren(pid, task);
                    const pids = children.trim().split(/[\s\u0000]+/).filter(Boolean);
                    for (const value of pids) {
                        const parsed = Number.parseInt(value, 10);
                        if (Number.isFinite(parsed)) union.add(parsed);
                        direct.push(parsed);
                    }
                } catch {
                    // Try the next task; fall through to [] if none yields.
                }
            }
            // Descendants too: the npm wrapper spawns the native binary which
            // spawns `serve` — the listener owner can be a grandchild.
            if (maxDepth > 1) {
                for (const child of direct) {
                    const grandChildren = await listChildPids(child, { ...opts, maxDepth: maxDepth - 1 });
                    for (const grandChild of grandChildren) union.add(grandChild);
                }
            }
            return [...union];
        }
        const run = async (command: string, args: string[]): Promise<string> => {
            if (opts?.execImpl) {
                return await opts.execImpl(command, args);
            }
            const { stdout } = await execFileAsync(command, args, { timeout: 5000 });
            return stdout;
        };
        const output = await run('pgrep', ['-P', String(pid)]);
        const direct = output.trim().split('\n')
            .map((line) => line.trim())
            .filter(Boolean)
            .map((value) => Number.parseInt(value, 10))
            .filter((value) => Number.isFinite(value));
        // Descendants too: the npm wrapper spawns the native binary which
        // spawns `serve` — the listener owner can be a grandchild.
        const union = new Set<number>(direct);
        if (maxDepth > 1) {
            for (const child of direct) {
                const grandChildren = await listChildPids(child, { ...opts, maxDepth: maxDepth - 1 });
                for (const grandChild of grandChildren) union.add(grandChild);
            }
        }
        return [...union];
    } catch {
        return [];
    }
}

/**
 * Parses `ss -tlnp` output and returns the set of 127.0.0.1 ports whose
 * process line contains `pid=<pid>` (a line may list several pids).
 */
export function parseSsPidListeners(output: string, pid: number): Set<number> {
    const ports = new Set<number>();
    for (const line of output.split('\n')) {
        if (!/\bLISTEN\b/.test(line)) continue;
        const pids = [...line.matchAll(/pid=(\d+)/g)].map((match) => Number.parseInt(match[1]!, 10));
        if (!pids.includes(pid)) continue;
        const match = /127\.0\.0\.1:(\d+)/.exec(line);
        if (match) {
            ports.add(Number.parseInt(match[1]!, 10));
        }
    }
    return ports;
}

/**
 * Lists loopback TCP listeners owned by the given pid: `ss -tlnp` with
 * `pid=<N>` matching first, `lsof -a -p <pid> -iTCP -sTCP:LISTEN -n -P`
 * (whose -p filter already scopes the output) as fallback. Throws when both
 * tools are unavailable so callers can disable optional REST operations;
 * an empty set means no owned loopback listener was found (yet).
 */
export async function listLoopbackListenersForPids(pids: number[], opts?: {
    platform?: NodeJS.Platform;
    execImpl?: (command: string, args: string[]) => Promise<string>;
}): Promise<Set<number>> {
    if (pids.length === 0) return new Set();
    const run = async (command: string, args: string[]): Promise<string> => {
        if (opts?.execImpl) {
            return await opts.execImpl(command, args);
        }
        const { stdout } = await execFileAsync(command, args, { timeout: 5000 });
        return stdout;
    };
    const ports = new Set<number>();
    try {
        const output = await run('ss', ['-tlnp']);
        for (const pid of pids) {
            for (const port of parseSsPidListeners(output, pid)) {
                ports.add(port);
            }
        }
        return ports;
    } catch {
        // -a -p <pid> -iTCP -sTCP:LISTEN -n -P is portable across darwin/linux lsof builds.
        // Per-pid aggregation: lsof exits non-zero when a pid owns no socket
        // (macOS commonly has no ss; the ACP parent often owns no listener).
        // A no-match result is an empty set for that pid — discarding it via
        // Promise.all rejection would hide a sibling's verified listener.
        const owned = await Promise.all(pids.map(async (pid) => {
            const lsofArgs = ['-a', '-p', String(pid), '-iTCP', '-sTCP:LISTEN', '-n', '-P'];
            try {
                return parseLsofListeners(await run('lsof', lsofArgs));
            } catch (error) {
                // A missing lsof binary is a tool failure: rethrow so the
                // caller disables optional REST operations.
                if (error && typeof error === 'object' && (error as NodeJS.ErrnoException).code === 'ENOENT') {
                    throw error;
                }
                return new Set<number>();
            }
        }));
        for (const set of owned) {
            for (const port of set) {
                ports.add(port);
            }
        }
        return ports;
    }
}

/**
 * Lists loopback TCP listeners via `ss -tln` (Linux), falling back to
 * `lsof -iTCP -sTCP:LISTEN -n -P` (darwin). Both failing yields an empty
 * set — callers treat that as "no new ports will ever be discovered" and
 * take the compact-unavailable fallback.
 */
export async function listLoopbackListeners(opts?: {
    platform?: NodeJS.Platform;
    execImpl?: (command: string, args: string[]) => Promise<string>;
}): Promise<Set<number>> {
    const platform = opts?.platform ?? process.platform;
    const run = async (command: string, args: string[]): Promise<string> => {
        if (opts?.execImpl) {
            return await opts.execImpl(command, args);
        }
        const { stdout } = await execFileAsync(command, args, { timeout: 5000 });
        return stdout;
    };
    if (platform === 'darwin') {
        try {
            return parseLsofListeners(await run('lsof', ['-iTCP', '-sTCP:LISTEN', '-n', '-P']));
        } catch {
            return new Set();
        }
    }
    try {
        return parseSsListeners(await run('ss', ['-tln']));
    } catch {
        try {
            return parseLsofListeners(await run('lsof', ['-iTCP', '-sTCP:LISTEN', '-n', '-P']));
        } catch {
            return new Set();
        }
    }
}


/**
 * Finds the descendant process that actually serves the v2 REST API: its
 * command line contains the standalone `serve` argument with `--stdio`.
 * Identifying it lets port discovery and credential lookup use a single,
 * unambiguous process instead of picking the lowest listener across a tree
 * that may also own unrelated listeners (e.g. configured MCP servers).
 * Returns null when no descendant matches; the caller then disables the
 * optional v2 REST bridge.
 */
export async function findOpencodeServePid(opts: {
    rootPids: number[];
    platform?: NodeJS.Platform;
    readCmdlineFile?: (pid: number) => Promise<string>;
    execImpl?: (command: string, args: string[]) => Promise<string>;
    maxDepth?: number;
}): Promise<number | null> {
    const platform = opts?.platform ?? process.platform;
    const isServeCommand = (cmdline: string): boolean =>
        /\bserve\b/.test(cmdline) && /--stdio/.test(cmdline);
    try {
        if (platform === 'linux') {
            const readCmdline = opts?.readCmdlineFile ?? (async (p: number) =>
                await readFileUtf8(`/proc/${p}/cmdline`));
            const seen = new Set<number>();
            const queue = [...opts.rootPids];
            let depth = 0;
            while (queue.length > 0 && depth <= (opts?.maxDepth ?? 4)) {
                const pid = queue.shift()!;
                if (seen.has(pid)) continue;
                seen.add(pid);
                try {
                    if (isServeCommand(await readCmdline(pid))) return pid;
                } catch {
                    // Unreadable pid: skip, keep walking.
                }
                if (depth < (opts?.maxDepth ?? 4)) {
                    for (const child of await listChildPids(pid, { platform })) {
                        if (!seen.has(child)) queue.push(child);
                    }
                }
                depth += 1;
            }
            return null;
        }
        const run = async (command: string, args: string[]): Promise<string> => {
            if (opts?.execImpl) {
                return await opts.execImpl(command, args);
            }
            const { stdout } = await execFileAsync(command, args, { timeout: 5000 });
            return stdout;
        };
        const seen = new Set<number>();
        const queue = [...opts.rootPids];
        let depth = 0;
        while (queue.length > 0 && depth <= (opts?.maxDepth ?? 4)) {
            const pid = queue.shift()!;
            if (seen.has(pid)) continue;
            seen.add(pid);
            try {
                // ps Eww embeds the environment after COMMAND; isolate the
                // command portion before matching (mirrors the credential
                // reader's env-substring guard).
                const psOutput = await run('ps', ['Eww', '-p', String(pid)]);
                const commandPortion = psOutput.split(/\s+[A-Za-z_][A-Za-z0-9_]*=/)[0] ?? psOutput;
                if (isServeCommand(commandPortion)) return pid;
            } catch {
                // Unreadable pid: skip, keep walking.
            }
            if (depth < (opts?.maxDepth ?? 4)) {
                for (const child of await listChildPids(pid, { platform, execImpl: opts?.execImpl })) {
                    if (!seen.has(child)) queue.push(child);
                }
            }
            depth += 1;
        }
        return null;
    } catch {
        return null;
    }
}

/** Resolve only a listener owned by the identified OpenCode serve process.
 * An unrelated new loopback listener must never receive the server credential. */
export async function discoverOpencodeV2RestPort(opts: {
    beforeSnapshot: Set<number>;
    timeoutMs?: number;
    pollIntervalMs?: number;
    ownerPid?: number;
    ownerPids?: number[];
    scanOwnedImpl?: (pids: number[]) => Promise<Set<number>>;
}): Promise<number | null> {
    const ownerPids = opts.ownerPids ?? (opts.ownerPid != null ? [opts.ownerPid] : []);
    if (ownerPids.length === 0) return null;
    const scanOwned = opts.scanOwnedImpl ?? listLoopbackListenersForPids;
    const deadline = Date.now() + (opts.timeoutMs ?? 10_000);
    while (Date.now() < deadline) {
        try {
            const owned = [...await scanOwned(ownerPids)].sort((a, b) => a - b);
            if (owned.length > 0) {
                const fresh = owned.filter(port => !opts.beforeSnapshot.has(port));
                return (fresh[0] ?? owned[0])!;
            }
        } catch {
            // Without process ownership proof, optional REST operations stay unavailable.
            return null;
        }
        await new Promise(resolve => setTimeout(resolve, opts.pollIntervalMs ?? 500));
    }
    return null;
}
