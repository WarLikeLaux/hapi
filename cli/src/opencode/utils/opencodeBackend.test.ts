import { parse } from 'jsonc-parser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const constructorCalls: Array<{ command: string; args?: string[]; env?: Record<string, string> }> = [];

vi.mock('@/agent/backends/acp', () => ({
    AcpSdkBackend: vi.fn().mockImplementation(function (
        this: unknown,
        opts: { command: string; args?: string[]; env?: Record<string, string> }
    ) {
        constructorCalls.push(opts);
        return { __opts: opts };
    })
}));

import { allocateFreePort, createOpencodeBackend } from './opencodeBackend';

describe('allocateFreePort', () => {
    it('resolves a bindable loopback port number', async () => {
        const port = await allocateFreePort('127.0.0.1');
        expect(typeof port).toBe('number');
        expect(Number.isInteger(port)).toBe(true);
        expect(port).toBeGreaterThan(0);
        expect(port).toBeLessThan(65536);
    });

    it('releases the port so it can be reused by a later caller', async () => {
        // Each call must close its probe socket before resolving, otherwise a
        // consumer that immediately tries to bind the returned port (e.g. the
        // spawned `opencode acp --port <port>` process) would collide with it.
        const first = await allocateFreePort('127.0.0.1');
        const second = await allocateFreePort('127.0.0.1');
        expect(typeof second).toBe('number');
        // Not asserting first !== second (OS may reuse immediately-freed ports),
        // only that a second allocation does not hang or throw EADDRINUSE.
        expect(first).toBeGreaterThan(0);
    });
});

describe('createOpencodeBackend', () => {
    afterEach(() => vi.unstubAllEnvs());
    beforeEach(() => {
        constructorCalls.length = 0;
    });

    it('adds the server-supported Muse max variant without losing existing JSONC configuration', () => {
        const config = `{
            // Preserve a caller's provider URL and other model variants.
            "provider": {"opencode-go": {
                "options": {"baseURL": "http://127.0.0.1:1234"},
                "models": {"muse-spark-1.3-contributor": {"variants": {"high": {"reasoningEffort": "high"}}}}
            }},
            "instructions": ["/tmp/custom-instructions.md"],
        }`;
        vi.stubEnv('OPENCODE_CONFIG_CONTENT', config);
        createOpencodeBackend({ cwd: '/tmp/x' });
        expect(parse(constructorCalls[0]!.env!.OPENCODE_CONFIG_CONTENT)).toEqual({
            provider: { 'opencode-go': {
                options: { baseURL: 'http://127.0.0.1:1234' },
                models: { 'muse-spark-1.3-contributor': { variants: {
                    high: { reasoningEffort: 'high' }, max: { reasoningEffort: 'max' }
                } } }
            } },
            instructions: ['/tmp/custom-instructions.md']
        });
        expect(process.env.OPENCODE_CONFIG_CONTENT).toBe(config);
    });

    it('passes --port and --hostname args when provided', () => {
        createOpencodeBackend({ cwd: '/tmp/x', port: 5555, hostname: '127.0.0.1' });
        expect(constructorCalls[0]?.args).toEqual([
            'acp', '--cwd', '/tmp/x', '--port', '5555', '--hostname', '127.0.0.1'
        ]);
    });

    it('omits --port/--hostname when not provided (backward compatible)', () => {
        createOpencodeBackend({ cwd: '/tmp/x' });
        expect(constructorCalls[0]?.args).toEqual(['acp', '--cwd', '/tmp/x']);
    });
});
