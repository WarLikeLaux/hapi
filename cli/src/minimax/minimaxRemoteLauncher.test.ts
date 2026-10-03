import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AcpSdkBackend } from '@/agent/backends/acp';
import type { AgentMessage, McpServerStdio, PromptContent } from '@/agent/types';
import { ACP_INDETERMINATE_SYMBOL } from '@/agent/backends/acp/AcpStdioTransport';
import type { ApiSessionClient } from '@/api/apiSession';
import { MessageQueue2 } from '@/utils/MessageQueue2';
import { RPC_METHODS } from '@hapi/protocol/rpcMethods';
import { MinimaxSession } from './session';
import type { MinimaxMode } from './types';

const harness = vi.hoisted(() => ({
    createBackend: vi.fn(),
    cancelPermissions: vi.fn(async (_reason: string) => {})
}));
vi.mock('./utils/minimaxBackend', () => ({ createMinimaxBackend: harness.createBackend }));
vi.mock('@/codex/utils/buildHapiMcpBridge', () => ({
    buildHapiMcpBridge: async () => ({ server: { stop() {} }, mcpServers: {} })
}));
vi.mock('@/modules/common/permission/AcpPermissionHandler', () => ({
    AcpPermissionHandler: class { cancelAll = harness.cancelPermissions; }
}));
vi.mock('@/ui/logger', () => ({ logger: { debug: vi.fn(), warn: vi.fn() } }));

import { minimaxRemoteLauncher } from './minimaxRemoteLauncher';

function deferred<T = void>() {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}

function makeBackend() {
    return {
        initialize: vi.fn(async () => {}),
        newSession: vi.fn(async () => 'native-session'),
        loadSession: vi.fn(async (_options: { sessionId: string; cwd: string; mcpServers: McpServerStdio[] }) => 'native-session'),
        getConfigOptionByCategory: vi.fn(() => undefined),
        setMode: vi.fn(async () => {}),
        onStderrError: vi.fn(),
        setSessionInfoUpdateListener: vi.fn(),
        waitForResponseComplete: vi.fn(async () => {}),
        prompt: vi.fn(async (_sessionId: string, _content: PromptContent[], _onMessage: (message: AgentMessage) => void) => {}),
        cancelPrompt: vi.fn(async (_sessionId: string) => {}),
        refreshSessionInfo: vi.fn(async () => {}),
        sendExtensionRequest: vi.fn(async (_method: string, _params: Record<string, unknown>, _options?: { timeoutMs?: number }) => ({ mode: 'steered', turnId: 'native-turn' })),
        disconnect: vi.fn(async () => {})
    };
}

function startSession(backend = makeBackend()) {
    harness.createBackend.mockReturnValue(backend as unknown as AcpSdkBackend);
    const handlers = new Map<string, (payload?: unknown) => Promise<unknown>>();
    const client = {
        rpcHandlerManager: { registerHandler: (method: string, handler: (payload?: unknown) => Promise<unknown>) => handlers.set(method, handler) },
        setHapiTitleToolAvailable: vi.fn(), updateMetadata: vi.fn(), keepAlive: vi.fn(),
        sendSessionEvent: vi.fn(), sendAgentMessage: vi.fn(),
        emitMessagesConsumed: vi.fn(), emitSteerIndeterminate: vi.fn(),
        setSteerDeliveryState: vi.fn(async () => true)
    };
    const queue = new MessageQueue2<MinimaxMode>((mode) => JSON.stringify(mode));
    const session = new MinimaxSession({
        api: {} as never, client: client as unknown as ApiSessionClient,
        path: '/tmp/project', logPath: '/tmp/log', sessionId: null, messageQueue: queue,
        onModeChange: () => {}, mode: 'remote', startedBy: 'runner', startingMode: 'remote', permissionMode: 'default'
    });
    session.stopKeepAlive();
    const run = minimaxRemoteLauncher(session, {});
    return { session, queue, handlers, client, run, backend };
}

const mode: MinimaxMode = { permissionMode: 'default' };

describe('MiniMax remote turn controls', () => {
    beforeEach(() => {
        harness.createBackend.mockReset();
        harness.cancelPermissions.mockReset().mockResolvedValue();
        process.stdin.isTTY = false;
        process.stdout.isTTY = false;
    });
    afterEach(() => { vi.useRealTimers(); });

    it('delivers native steer once and acknowledges only native acceptance, even when the foreground prompt settles first', async () => {
        const foreground = deferred();
        const acceptance = deferred<{ mode: string; turnId: string }>();
        const backend = makeBackend();
        backend.prompt.mockImplementationOnce(() => foreground.promise);
        backend.sendExtensionRequest.mockImplementationOnce(() => acceptance.promise);
        const h = startSession(backend);
        h.queue.push('first', mode, 'first');
        await vi.waitFor(() => expect(backend.prompt).toHaveBeenCalledTimes(1));
        h.queue.push('steer text', mode, 'steer');
        h.queue.push('later', mode, 'later');
        const handler = h.handlers.get(RPC_METHODS.SteerQueuedMessage);
        expect(handler).toBeDefined();
        const steering = handler!({ localId: 'steer' });
        await vi.waitFor(() => expect(backend.sendExtensionRequest).toHaveBeenCalledTimes(1));
        expect(backend.sendExtensionRequest.mock.calls[0]).toEqual([
            'mcode/session/steer', { sessionId: 'native-session', text: 'steer text', clientRequestId: 'steer' }, { timeoutMs: 10_000 }
        ]);
        expect(h.client.emitMessagesConsumed).not.toHaveBeenCalledWith(['steer'], { steered: true });
        expect(await handler!({ localId: 'steer' })).toMatchObject({ steered: false });
        foreground.resolve();
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(backend.prompt).toHaveBeenCalledTimes(1);
        expect(await handler!({ localId: 'later' })).toMatchObject({ steered: false });
        acceptance.resolve({ mode: 'steered', turnId: 'native-turn' });
        expect(await steering).toEqual({ steered: true });
        h.queue.close();
        await h.run;
        expect(h.client.emitMessagesConsumed).toHaveBeenCalledWith(['steer'], { steered: true });
        expect(backend.prompt.mock.calls.map((call) => call[1])).toEqual([
            [{ type: 'text', text: 'first' }], [{ type: 'text', text: 'later' }]
        ]);
    });

    it.each([false, true])('keeps a rejected steer in FIFO, but holds an ambiguous delivery outside automatic replay (ambiguous=%s)', async (ambiguous) => {
        const foreground = deferred();
        const backend = makeBackend();
        backend.prompt.mockImplementationOnce(() => foreground.promise);
        const error = new Error(ambiguous ? 'Transport lost' : 'No active turn');
        if (ambiguous) Object.defineProperty(error, ACP_INDETERMINATE_SYMBOL, { value: true });
        backend.sendExtensionRequest.mockRejectedValueOnce(error);
        const h = startSession(backend);
        h.queue.push('first', mode, 'first');
        await vi.waitFor(() => expect(backend.prompt).toHaveBeenCalledTimes(1));
        h.queue.push('before', mode, 'before');
        h.queue.push('steer text', mode, 'steer');
        h.queue.push('after', mode, 'after');
        expect(h.handlers.has(RPC_METHODS.SteerQueuedMessage)).toBe(true);
        expect(await h.handlers.get(RPC_METHODS.SteerQueuedMessage)!({ localId: 'steer' })).toMatchObject({ steered: false });
        expect(h.client.emitMessagesConsumed).not.toHaveBeenCalledWith(['steer'], { steered: true });
        expect(h.queue.pendingLocalIds()).toEqual(ambiguous ? ['before', 'after'] : ['before', 'steer', 'after']);
        if (ambiguous) expect(h.client.emitSteerIndeterminate).toHaveBeenCalledWith(['steer']);
        h.queue.close();
        foreground.resolve();
        await h.run;
    });

    it('preserves a new message sent while Stop is cancelling permissions, waits for the old prompt, and retries runtime retirement', async () => {
        const foreground = deferred();
        const permissions = deferred();
        const backend = makeBackend();
        backend.prompt.mockImplementationOnce(() => foreground.promise)
            .mockRejectedValueOnce(new Error('Session already has an active Turn'));
        harness.cancelPermissions.mockImplementation(async (reason) => { if (reason === 'User aborted') await permissions.promise; });
        const h = startSession(backend);
        h.queue.push('first', mode, 'first');
        await vi.waitFor(() => expect(backend.prompt).toHaveBeenCalledTimes(1));
        const stopping = h.handlers.get(RPC_METHODS.Abort)!();
        h.queue.push('after stop', mode, 'next');
        await Promise.resolve();
        expect(h.session.thinking).toBe(true);
        permissions.resolve();
        await Promise.resolve();
        expect(backend.prompt).toHaveBeenCalledTimes(1);
        foreground.resolve();
        await stopping;
        await vi.waitFor(() => expect(backend.prompt).toHaveBeenCalledTimes(3));
        expect(backend.prompt.mock.calls.slice(1).map((call) => call[1])).toEqual([
            [{ type: 'text', text: 'after stop' }], [{ type: 'text', text: 'after stop' }]
        ]);
        h.queue.close();
        await h.run;
    });

    it('keeps the queue reader alive when Stop is pressed between turns', async () => {
        const h = startSession();
        await vi.waitFor(() => expect(h.handlers.has(RPC_METHODS.Abort)).toBe(true));
        await h.handlers.get(RPC_METHODS.Abort)!();
        h.queue.push('after idle stop', mode, 'next');
        await vi.waitFor(() => expect(h.backend.prompt).toHaveBeenCalledTimes(1));
        expect(h.backend.prompt.mock.calls[0][1]).toEqual([{ type: 'text', text: 'after idle stop' }]);
        h.queue.close();
        await h.run;
    });

    it('Stop cancels an active-turn retry instead of replaying the stopped message', async () => {
        vi.useFakeTimers();
        const backend = makeBackend();
        backend.prompt.mockRejectedValueOnce(new Error('Session already has an active Turn'));
        const h = startSession(backend);
        h.queue.push('stop this', mode, 'old');
        await vi.waitFor(() => expect(backend.prompt).toHaveBeenCalledTimes(1));
        await h.handlers.get(RPC_METHODS.Abort)!();
        h.queue.push('replacement', mode, 'next');
        await vi.waitFor(() => expect(backend.prompt).toHaveBeenCalledTimes(2));
        await vi.advanceTimersByTimeAsync(1000);
        expect(backend.prompt.mock.calls.map((call) => call[1])).toEqual([
            [{ type: 'text', text: 'stop this' }], [{ type: 'text', text: 'replacement' }]
        ]);
        h.queue.close();
        await h.run;
    });

    it.each([false, true])('recovers a hung Stop by reloading the same session and never silently starts a fresh chat (load failure=%s)', async (loadFails) => {
        vi.useFakeTimers();
        const foreground = deferred();
        const backend = makeBackend();
        backend.prompt.mockImplementationOnce(() => foreground.promise);
        backend.disconnect.mockImplementation(async () => { foreground.reject(new Error('Transport closed')); });
        const recovered = makeBackend();
        if (loadFails) recovered.loadSession.mockRejectedValue(new Error('Cannot load history'));
        const h = startSession(backend);
        const outcome = h.run.catch((error: Error) => error);
        h.queue.push('first', mode, 'first');
        await vi.waitFor(() => expect(backend.prompt).toHaveBeenCalledTimes(1));
        harness.createBackend.mockReturnValue(recovered);
        const stopping = h.handlers.get(RPC_METHODS.Abort)!();
        h.queue.push('after hung stop', mode, 'next');
        await vi.advanceTimersByTimeAsync(4900);
        expect(backend.disconnect).not.toHaveBeenCalled();
        expect(recovered.prompt).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(100);
        await stopping;
        await vi.waitFor(() => expect(recovered.loadSession).toHaveBeenCalledWith({ sessionId: 'native-session', cwd: '/tmp/project', mcpServers: [] }));
        expect(recovered.newSession).not.toHaveBeenCalled();
        if (loadFails) {
            expect(await outcome).toMatchObject({ message: 'Cannot load history' });
            expect(recovered.prompt).not.toHaveBeenCalled();
        } else {
            await vi.waitFor(() => expect(recovered.prompt).toHaveBeenCalledTimes(1));
            expect(recovered.prompt.mock.calls[0][1]).toEqual([{ type: 'text', text: 'after hung stop' }]);
            h.queue.close();
            await h.run;
        }
    });

    it('does not inject into a cancelled turn when Stop races durable steer preparation', async () => {
        const foreground = deferred();
        const persistence = deferred<boolean>();
        const backend = makeBackend();
        backend.prompt.mockImplementationOnce(() => foreground.promise);
        const h = startSession(backend);
        h.queue.push('first', mode, 'first');
        await vi.waitFor(() => expect(backend.prompt).toHaveBeenCalledTimes(1));
        h.queue.push('steer text', mode, 'steer');
        h.client.setSteerDeliveryState.mockImplementationOnce(() => persistence.promise);
        const steering = h.handlers.get(RPC_METHODS.SteerQueuedMessage)!({ localId: 'steer' });
        const stopping = h.handlers.get(RPC_METHODS.Abort)!();
        foreground.resolve();
        persistence.resolve(true);
        expect(await steering).toMatchObject({ steered: false });
        await stopping;
        await vi.waitFor(() => expect(backend.prompt).toHaveBeenCalledTimes(2));
        expect(backend.sendExtensionRequest).not.toHaveBeenCalled();
        expect(backend.prompt.mock.calls[1][1]).toEqual([{ type: 'text', text: 'steer text' }]);
        h.queue.close();
        await h.run;
    });
});
