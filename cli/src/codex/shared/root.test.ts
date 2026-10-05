import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import type { ApiSessionClient } from '@/api/apiSession';
import type { AgentState, Metadata, UserMessage } from '@/api/types';
import type { SessionBootstrapResult } from '@/agent/sessionFactory';
import { SharedCodexRoot, type RootHost } from './root';
import { codexPlanProposalId } from './plan';
import { RPC_METHODS } from '@hapi/protocol/rpcMethods';

type NativeTurn = { id: string; status: string; items: unknown[] };

vi.mock('../codexAppServerClient', () => ({
    CodexAppServerClient: class {
        initialized = false;
        thread = { id: 'thread', turns: [] as NativeTurn[] };
        settings: Record<string, unknown> = { model: 'mock', collaborationMode: { mode: 'default' } };
        queue: Array<{ id: string; clientUserMessageId: unknown; input: unknown }> = [];
        notify?: (method: string, params: unknown) => void;
        abandoned?: () => void;
        setNotificationHandler(handler: typeof this.notify) { this.notify = handler; }
        setTransportAbandonedHandler(handler: (() => void) | null) { this.abandoned = handler ?? undefined; }
        setServerRequestHandler() {}
        async connect() {}
        async initialize() { this.initialized = true; }
        isInitialized() { return this.initialized; }
        async disconnect() { this.initialized = false; }
        async request(method: string, params: Record<string, unknown> = {}) {
            if (method === 'thread/read' || method === 'thread/resume') return { ...this.settings, thread: structuredClone(this.thread) };
            if (method === 'thread/list') return { data: [] };
            if (method === 'thread/queue/list') return { data: this.queue };
            if (method === 'thread/inject_items') return {};
            if (method === 'thread/settings/update') {
                this.settings = { ...this.settings, ...params };
                this.notify?.('thread/settings/updated', { threadId: 'thread', threadSettings: this.settings });
                return {};
            }
            if (method === 'thread/queue/add') {
                const entry = { id: `queued-${this.queue.length}`, clientUserMessageId: params.clientUserMessageId, input: params.input };
                this.queue.push(entry);
                return { queuedSubmission: entry };
            }
            if (method === 'turn/steer') {
                const turn = this.thread.turns.find(turn => turn.id === params.expectedTurnId);
                if (!turn || turn.status !== 'inProgress') throw new Error('Turn is no longer active');
                const item = { id: 'steered-answer', type: 'userMessage', clientId: params.clientUserMessageId, content: params.input };
                turn.items.push(item);
                this.notify?.('item/completed', { threadId: 'thread', turnId: turn.id, item });
                return { turnId: turn.id };
            }
            throw new Error(`Unexpected request: ${method}`);
        }
    },
    isIndeterminateError: () => false
}));
vi.mock('../utils/buildHapiMcpBridge', () => ({ buildHapiMcpBridge: async () => ({
    mcpServers: {}, server: { stop() {} }
}) }));

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
    try { for (const cleanup of cleanups.splice(0)) await cleanup(); }
    finally { vi.useRealTimers(); }
});

async function fixture(opts?: { hubArchived?: boolean; end?: RootHost['end']; initialState?: AgentState; publishInitialHistory?: boolean }) {
    const directory = await mkdtemp('/tmp/hapi-shared-root-');
    let state: AgentState = opts?.initialState ?? { steeringActive: true };
    let metadata: Metadata = { path: directory, host: 'test', flavor: 'codex' };
    let reconnect: (() => void) | null = null;
    let userMessage: ((message: UserMessage, localId?: string) => void) | null = null;
    const updateState = vi.fn((fn: (value: AgentState) => AgentState) => { state = fn(state); });
    const rpc = new Map<string, (raw: unknown) => Promise<unknown>>();
    const send = vi.fn();
    const hubArchivedListeners: Array<() => void> = [];
    const session = {
        sessionId: 'sid', getMetadata: () => metadata,
        hubArchived: opts?.hubArchived ?? false,
        updateMetadata: (fn: (value: Metadata) => Metadata) => { metadata = fn(metadata); },
        updateAgentState: updateState, keepAlive() {},
        setHapiTitleToolAvailable: vi.fn(),
        onUserMessage: (fn: typeof userMessage) => { userMessage = fn; }, onCancelQueuedMessage() {}, onRetryQueuedMessage() {},
        onReconnect: (fn: (() => void) | null) => { reconnect = fn; },
        on(event: string, listener: () => void) {
            if (event === 'hub-archived') hubArchivedListeners.push(listener);
        },
        rpcHandlerManager: { registerHandler: (name: string, handler: (raw: unknown) => Promise<unknown>) => rpc.set(name, handler) },
        sendSessionEvent() {}, sendAgentMessage: send, emitSessionReady() {},
        sendUserMessage: vi.fn(), emitMessagesConsumed() {}, emitSteerIndeterminate() {}, syncNativeQueuedMessage() {},
        sendSessionDeath() {}, async flush() {}, close() {}
    } as unknown as ApiSessionClient;
    const end = opts?.end ?? (async () => { throw new Error('Unexpected root archive'); });
    const root = new SharedCodexRoot({ session, workingDirectory: directory } as SessionBootstrapResult, {
        directory, generation: 'test', endpoint: 'mock', settingsFor: () => undefined,
        create: async () => { throw new Error('Unexpected root creation'); },
        end
    } satisfies RootHost, opts?.publishInitialHistory);
    cleanups.push(async () => { await root.close(false); await rm(directory, { recursive: true, force: true }); });
    await root.prepare();
    await root.bind('thread', { model: 'mock', thread: { turns: [] } }, false);
    const native = root.client as unknown as {
        initialized: boolean;
        thread: { id: string; turns: NativeTurn[] };
        queue: Array<{ id: string; clientUserMessageId: string; input: unknown }>;
        notify(method: string, params: unknown): void;
        abandoned(): void;
    };
    return {
        root, native, rpc, send, metadata: () => metadata, state: () => state, updateState,
        postUser: (message: UserMessage, localId?: string) => userMessage?.(message, localId),
        reconnect: () => reconnect?.(),
        emitHubArchived: () => { for (const listener of hubArchivedListeners) listener(); },
        hubArchivedListenerCount: () => hubArchivedListeners.length,
        end,
    };
}

async function completePlan(f: Awaited<ReturnType<typeof fixture>>, status = 'completed') {
    await f.root.applySettings({ collaborationMode: 'plan' });
    const turn = { id: 'plan-turn', status: 'inProgress', items: [{ id: 'plan-item', type: 'plan', text: '# Implement me' }] };
    f.native.thread.turns.push(turn);
    f.native.notify('turn/started', { threadId: 'thread', turn: { id: turn.id } });
    f.native.notify('item/completed', { threadId: 'thread', turnId: turn.id, item: turn.items[0] });
    expect(f.state().codexPlanProposalId).toBeNull();
    turn.status = status;
    f.native.notify('turn/completed', { threadId: 'thread', turn: { id: turn.id, status } });
    await vi.waitFor(() => expect(f.send).toHaveBeenCalledWith(expect.objectContaining({ name: 'ExitPlanMode' }), expect.any(String)));
    return codexPlanProposalId('thread', turn.id, 'plan-item');
}

describe('shared async questions', () => {
    it('clears a persisted question answered after resume without loading history', async () => {
        const questionId = 'codex-async-question:thread:ask';
        const f = await fixture({ publishInitialHistory: false, initialState: { codexAsyncQuestions: {
            [questionId]: { tool: 'request_user_input_async', arguments: { questions: [{ id: '0', question: 'Choose?' }] } }
        } } });
        await f.root.activate();
        f.native.thread.turns.push({ id: 'turn', status: 'completed', items: [
            { id: 'ask', type: 'agentMessage', delivery: 'async', questions: [{ title: 'Choose?', options: ['Chat'] }] }
        ] });
        await f.rpc.get('answer-codex-async-question')!({ questionId, answers: { '0': { answers: ['Chat'] } } });
        expect(f.state().codexAsyncQuestions).toEqual({});
    });

    it.each([false, true])('projects async questions and delivers exactly one reply (active turn: %s)', async active => {
        const f = await fixture();
        await f.root.activate();
        const item = { id: 'ask', type: 'agentMessage', delivery: 'async', text: 'Choose a workflow',
            questions: [{ title: 'Workflow?', options: ['Chat', 'Page'] }, { title: 'Details?', options: null }] };
        f.native.thread.turns.push({ id: 'turn', status: active ? 'inProgress' : 'completed', items: [item] });
        f.native.notify('item/completed', { threadId: 'thread', turnId: 'turn', item });
        await vi.waitFor(() => expect(f.send).toHaveBeenCalledWith(expect.objectContaining({
            type: 'tool-call', name: 'request_user_input_async', callId: 'codex-async-question:thread:ask',
            input: expect.objectContaining({ questions: [
                expect.objectContaining({ id: '0', question: 'Workflow?', options: [{ label: 'Chat' }, { label: 'Page' }] }),
                expect.objectContaining({ id: '1', question: 'Details?', options: [] })
            ] })
        }), expect.any(String)));
        expect(f.state()).toMatchObject({ codexAsyncQuestions: {
            'codex-async-question:thread:ask': { tool: 'request_user_input_async' }
        } });
        f.reconnect();
        await f.root.refresh();
        expect(Object.keys(f.state().codexAsyncQuestions ?? {})).toEqual(['codex-async-question:thread:ask']);
        const answer = f.rpc.get('answer-codex-async-question')!;
        const request = { questionId: 'codex-async-question:thread:ask', answers: {
            '0': { answers: ['Page'] }, '1': { answers: ['user_note: private diary'] }
        } };
        await expect(answer({ ...request, answers: {} })).rejects.toThrow('Answer every question');
        const nativeRequest = vi.spyOn(f.root.client, 'request');
        await answer(request);
        expect(f.state().codexAsyncQuestions).toEqual({});
        await answer({ ...request, answers: { '0': { answers: ['Chat'] }, '1': { answers: ['changed'] } } });
        const deliveries = nativeRequest.mock.calls.filter(([method]) => method === (active ? 'turn/steer' : 'thread/queue/add'));
        expect(deliveries).toHaveLength(1);
        expect(JSON.stringify(deliveries[0][1])).toContain('private diary');
        expect(f.send.mock.calls.filter(([body]) => body.type === 'tool-call-result' && body.output?.answers).at(-1)?.[0])
            .toMatchObject({ callId: request.questionId, output: { answers: request.answers } });
        if (active) await vi.waitFor(() => expect(f.root.session.sendUserMessage).toHaveBeenCalledWith(
            'Workflow?\nPage\n\nDetails?\nprivate diary', undefined, `${request.questionId}:answer`
        ));
        await expect(answer({ ...request, questionId: 'codex-async-question:other:ask' })).rejects.toThrow();
        f.send.mockClear();
        f.reconnect();
        await f.root.refresh();
        expect(f.send.mock.calls.some(([body]) => body.type === 'tool-call-result' && body.output?.answers)).toBe(true);
        await answer(request);
        expect(nativeRequest.mock.calls.filter(([method]) => method === (active ? 'turn/steer' : 'thread/queue/add'))).toHaveLength(1);
        expect(f.state().codexAsyncQuestions).toEqual({});
        expect(f.send.mock.calls.filter(([body]) => body.type === 'tool-call-result' && body.output?.answers).at(-1)?.[0])
            .toMatchObject({ callId: request.questionId, output: { answers: request.answers } });
    });

    it('keeps an uncertain reply unresolved and refuses a blind retry', async () => {
        const f = await fixture();
        await f.root.activate();
        const indeterminate = vi.spyOn(f.root.session, 'emitSteerIndeterminate');
        f.native.thread.turns.push({ id: 'turn', status: 'completed', items: [
            { id: 'ask', type: 'agentMessage', delivery: 'async', text: 'Choose', questions: [{ title: 'Choose', options: ['Chat'] }] }
        ] });
        const nativeRequest = f.root.client.request.bind(f.root.client);
        const request = vi.spyOn(f.root.client, 'request').mockImplementation(async (method, params) => {
            if (method === 'thread/queue/add') return {};
            return nativeRequest(method, params);
        });
        const answer = f.rpc.get('answer-codex-async-question')!;
        const payload = { questionId: 'codex-async-question:thread:ask', answers: { '0': { answers: ['Chat'] } } };
        await expect(answer(payload)).rejects.toThrow();
        expect(indeterminate).toHaveBeenCalledWith([`${payload.questionId}:answer`]);
        await expect(answer(payload)).rejects.toThrow('Previous answer delivery is uncertain');
        expect(request.mock.calls.filter(([method]) => method === 'thread/queue/add')).toHaveLength(1);
        expect(f.send.mock.calls.some(([body]) => body.type === 'tool-call-result' && body.output?.answers)).toBe(false);
    });
});

describe('shared settings confirmation', () => {
    it('skips the native round trip when the requested state already holds (Codex 0.157 no-op suppression)', async () => {
        const f = await fixture();
        // Cold-resume snapshot: thread/resume reports the active collaboration
        // mode with its built-in instructions expanded inline, and 0.157 emits
        // no thread/settings/updated when the same state is re-applied.
        f.native.notify('thread/settings/updated', { threadId: 'thread', threadSettings: {
            model: 'mock', effort: null,
            collaborationMode: { mode: 'plan', settings: { model: 'mock', reasoning_effort: null, developer_instructions: '# Expanded plan instructions' } }
        } });
        const request = vi.spyOn(f.root.client, 'request');
        const { applied } = await f.root.applySettings({ collaborationMode: 'plan' });
        expect(applied.collaborationMode).toBe('plan');
        expect(request.mock.calls.some(([method]) => method === 'thread/settings/update')).toBe(false);
    });
    it('confirms a lost notification when the native state already matches the request', async () => {
        const f = await fixture();
        const request = vi.spyOn(f.root.client, 'request').mockResolvedValue({});
        vi.useFakeTimers();
        try {
            // No notification will arrive for this update; the native snapshot
            // catching up must still resolve the wait instead of erroring.
            const pending = f.root.applySettings({ model: 'mock2' });
            await vi.advanceTimersByTimeAsync(0);
            const root = f.root as unknown as { settingsNative: Record<string, unknown> };
            root.settingsNative = { ...root.settingsNative, model: 'mock2' };
            await vi.advanceTimersByTimeAsync(15_000);
            await expect(pending).resolves.toHaveProperty('applied');
        } finally { vi.useRealTimers(); request.mockRestore(); }
    });
});

describe('shared plan actions', () => {
    it('passes the user prompt through to native Codex with no extra reminder injection', async () => {
        // The hidden HAPI title-check block is now prepended centrally in
        // ApiSession.enqueueUserMessage so every flavor sees it. Codex must
        // therefore not inject its own duplicate `thread/inject_items` call —
        // the runner just forwards whatever text arrived on the user prompt.
        const f = await fixture();
        await f.root.activate();
        f.root.session.updateMetadata(metadata => ({ ...metadata, name: 'Current title' }));
        const request = vi.spyOn(f.root.client, 'request');
        f.postUser({ role: 'user', content: { type: 'text', text: 'A new objective' } }, 'local');
        await vi.waitFor(() => expect(f.native.queue).toHaveLength(1));
        const injectIndex = request.mock.calls.findIndex(([method]) => method === 'thread/inject_items');
        expect(injectIndex).toBe(-1);
    });

    it('applies remote change_title as metadata.name then lets native terminal rename win', async () => {
        const f = await fixture();
        const item = { id: 'title', type: 'mcpToolCall', server: 'hapi', tool: 'change_title',
            arguments: { title: 'Remote title' }, status: 'completed', result: { content: [], isError: false } };
        f.native.notify('item/completed', { threadId: 'thread', turnId: 'turn', item });
        await vi.waitFor(() => expect(f.metadata().name).toBe('Remote title'));
        f.native.notify('thread/name/updated', { threadId: 'thread', threadName: 'Terminal title' });
        await vi.waitFor(() => expect(f.metadata().name).toBe('Terminal title'));
        await f.root.refresh();
        expect(f.metadata().name).toBe('Terminal title');
    });

    it('preserves content while native turns, mode changes and disconnects withdraw controls', async () => {
        const f = await fixture();
        const id = await completePlan(f);
        expect(f.state().codexPlanProposalId).toBe(id);
        expect(f.state().requests).toEqual({});
        await f.root.applySettings({ collaborationMode: 'default' });
        expect(f.state().codexPlanProposalId).toBeNull();
        await f.root.applySettings({ collaborationMode: 'plan' });
        expect(f.state().codexPlanProposalId).toBe(id);
        f.native.initialized = false; f.native.abandoned();
        expect(f.state().codexPlanProposalId).toBeNull();
        await vi.waitFor(() => expect(f.state().codexPlanProposalId).toBe(id));
        f.native.notify('turn/started', { threadId: 'thread', turn: { id: 'new' } });
        f.native.notify('turn/completed', { threadId: 'thread', turn: { id: 'plan-turn', status: 'completed' } });
        expect(f.state().codexPlanProposalId).toBeNull();
        expect(f.send.mock.calls.some(([message]) => message.input?.plan === '# Implement me')).toBe(true);
    });

    it.each(['failed', 'interrupted'])('does not offer a proposal from a %s turn', async status => {
        const f = await fixture();
        await completePlan(f, status);
        await f.root.refresh();
        expect(f.state().codexPlanProposalId).toBeNull();
    });

    it('uses only the latest root turn when replaying history', async () => {
        const f = await fixture();
        const id = await completePlan(f);
        f.reconnect();
        await f.root.refresh();
        await vi.waitFor(() => expect(f.state().codexPlanProposalId).toBe(id));
        f.native.thread.turns.push({ id: 'new', status: 'completed', items: [] });
        await f.root.refresh();
        expect(f.state().codexPlanProposalId).toBeNull();
        f.native.notify('item/completed', { threadId: 'child', turnId: 'child-turn', item: { id: 'p', type: 'plan', text: 'child' } });
        expect(f.state().codexPlanProposalId).toBeNull();
    });

    it('switches mode and submits once across repeated Web actions and lost replies', async () => {
        const f = await fixture();
        await f.root.activate();
        const id = await completePlan(f);
        const action = () => f.rpc.get(RPC_METHODS.ImplementCodexPlan)!({ planId: id });
        const request = vi.spyOn(f.root.client, 'request');
        expect(await Promise.all([action(), action()])).toEqual([{ ok: true }, { ok: true }]);
        f.reconnect();
        expect(await action()).toEqual({ ok: true });
        expect(request.mock.calls.filter(([method]) => method === 'thread/queue/add')).toHaveLength(1);
        const settingsIndex = request.mock.calls.findIndex(([method]) => method === 'thread/settings/update');
        const queueIndex = request.mock.calls.findIndex(([method]) => method === 'thread/queue/add');
        expect(settingsIndex).toBeLessThan(queueIndex);
        expect(request.mock.calls[settingsIndex][1]).toMatchObject({ collaborationMode: { mode: 'default' } });
        expect(f.native.queue[0]).toMatchObject({ input: [{ type: 'text', text: 'Implement the plan.' }] });
        expect(f.state().codexPlanProposalId).toBeNull();
    });

    it('does not let a slow history snapshot resurrect a plan after native continuation', async () => {
        const f = await fixture();
        await completePlan(f);
        const request = f.root.client.request.bind(f.root.client);
        let release!: () => void;
        const blocked = new Promise<void>(resolve => { release = resolve; });
        let reading!: () => void;
        const started = new Promise<void>(resolve => { reading = resolve; });
        vi.spyOn(f.root.client, 'request').mockImplementation(async (method, params) => {
            const result = await request(method, params);
            if (method === 'thread/read' && (params as { includeTurns?: boolean }).includeTurns) {
                reading(); await blocked;
            }
            return result;
        });
        const refresh = f.root.refresh();
        await started;
        f.native.notify('turn/started', { threadId: 'thread', turn: { id: 'terminal-continued' } });
        release(); await refresh;
        expect(f.state().codexPlanProposalId).toBeNull();
    });

    it('does not change mode when native input appears during the action preflight', async () => {
        const f = await fixture();
        await f.root.activate();
        const id = await completePlan(f);
        const request = f.root.client.request.bind(f.root.client);
        const spy = vi.spyOn(f.root.client, 'request').mockImplementation(async (method, params) => {
            const result = await request(method, params);
            if (method === 'thread/queue/list') f.native.notify('turn/started', { threadId: 'thread', turn: { id: 'terminal' } });
            return result;
        });
        expect(await f.rpc.get(RPC_METHODS.ImplementCodexPlan)!({ planId: id })).toMatchObject({ ok: false, code: 'stale_plan' });
        expect(spy.mock.calls.some(([method]) => method === 'thread/settings/update')).toBe(false);
        expect(f.native.queue).toHaveLength(0);
    });

    it('rejects stale proposals and native activity arriving during the mode switch', async () => {
        const f = await fixture();
        await f.root.activate();
        const id = await completePlan(f);
        const action = (planId = id) => f.rpc.get(RPC_METHODS.ImplementCodexPlan)!({ planId });
        expect(await action('old')).toMatchObject({ ok: false, code: 'stale_plan' });
        const request = f.root.client.request.bind(f.root.client);
        vi.spyOn(f.root.client, 'request').mockImplementation(async (method, params) => {
            const result = await request(method, params);
            if (method === 'thread/settings/update') f.native.notify('turn/started', { threadId: 'thread', turn: { id: 'terminal' } });
            return result;
        });
        expect(await action()).toMatchObject({ ok: false, code: 'stale_plan' });
        expect(f.native.queue).toHaveLength(0);
    });

    it('does not resend an implementation with an unknown queue outcome', async () => {
        const f = await fixture();
        await f.root.activate();
        const id = await completePlan(f);
        const request = f.root.client.request.bind(f.root.client);
        const spy = vi.spyOn(f.root.client, 'request').mockImplementation(async (method, params) => {
            const result = await request(method, params);
            // An invalid response schema leaves delivery indeterminate even after acceptance.
            return method === 'thread/queue/add' ? {} : result;
        });
        const action = () => f.rpc.get(RPC_METHODS.ImplementCodexPlan)!({ planId: id });
        expect(await action()).toMatchObject({ ok: false, code: 'indeterminate' });
        f.native.queue = []; // Absence is not proof of cancellation or delivery.
        expect(await action()).toMatchObject({ ok: false, code: 'indeterminate' });
        expect(spy.mock.calls.filter(([method]) => method === 'thread/queue/add')).toHaveLength(1);
    });
});

describe('shared steering availability', () => {
    it('keeps idle sessions online without polling usage or publishing agent-state updates', async () => {
        const f = await fixture();
        const requests = vi.spyOn(f.root.client, 'request');
        const heartbeat = vi.spyOn(f.root.session, 'keepAlive');
        const updates = f.updateState.mock.calls.length;
        vi.useFakeTimers();

        await f.root.activate();
        await vi.advanceTimersByTimeAsync(5 * 60_000);

        expect(heartbeat).toHaveBeenCalled();
        expect(requests).not.toHaveBeenCalled();
        expect(f.updateState).toHaveBeenCalledTimes(updates);
    });

    it('does not revive an orphaned in-progress turn behind a completed latest turn', async () => {
        const f = await fixture();
        const heartbeat = vi.spyOn(f.root.session, 'keepAlive');
        f.native.thread.turns = [
            { id: 'orphaned', status: 'inProgress', items: [] },
            { id: 'latest', status: 'completed', items: [] }
        ];

        await f.root.refresh();

        expect(heartbeat).toHaveBeenLastCalledWith(false, undefined, expect.any(Object));
        expect(f.state().steeringActive).toBe(false);
    });

    it('publishes root turn transitions, ignores child turns, and clears on shutdown', async () => {
        const f = await fixture();
        expect(f.state().steeringActive).toBe(false);
        f.native.notify('turn/started', { threadId: 'thread', turn: { id: 'turn' } });
        expect(f.state().steeringActive).toBe(true);
        f.native.notify('turn/completed', { threadId: 'thread', turn: { id: 'old-turn' } });
        expect(f.state().steeringActive).toBe(true);
        f.native.notify('turn/completed', { threadId: 'thread', turn: { id: 'turn', status: 'completed' } });
        expect(f.state().steeringActive).toBe(false);
        f.native.notify('turn/started', { threadId: 'child', turn: { id: 'child-turn' } });
        expect(f.state().steeringActive).toBe(false);
        f.native.notify('turn/started', { threadId: 'thread', turn: { id: 'next' } });
        f.root.stopAccepting();
        expect(f.state().steeringActive).toBe(false);
    });

    it('reconciles native and Hub reconnects without publishing on every refresh', async () => {
        const f = await fixture();
        const updates = f.updateState.mock.calls.length;
        await f.root.refresh(); await f.root.refresh();
        expect(f.updateState).toHaveBeenCalledTimes(updates);
        f.native.thread.turns = [{ id: 'busy', status: 'inProgress', items: [] }];
        f.reconnect();
        await vi.waitFor(() => expect(f.state().steeringActive).toBe(true));
        f.native.initialized = false; f.native.abandoned();
        expect(f.state().steeringActive).toBe(false);
        await vi.waitFor(() => expect(f.state().steeringActive).toBe(true));
        f.native.thread.turns = [{ id: 'busy', status: 'completed', items: [] }];
        f.reconnect();
        await vi.waitFor(() => expect(f.state().steeringActive).toBe(false));
    });

    it('ends the shared root on hub-archived metadata (#1911 C2 / AC6)', async () => {
        const end = vi.fn<RootHost['end']>(async () => {});
        const f = await fixture({ end });
        await f.root.activate();
        expect(f.hubArchivedListenerCount()).toBe(1);
        f.emitHubArchived();
        await vi.waitFor(() => expect(end).toHaveBeenCalledTimes(1));
        expect(end.mock.calls[0]?.[0]).toBe(f.root);
    });

    it('ends when hubArchived was latched before activate (production order, #1911 AC6)', async () => {
        // Bootstrap may refuse CAS / noteHubArchived before Codex bind+activate
        // registers controls — same late-listener miss as other flavors.
        const end = vi.fn<RootHost['end']>(async () => {});
        const f = await fixture({ hubArchived: true, end });
        await f.root.activate();
        await vi.waitFor(() => expect(end).toHaveBeenCalledTimes(1));
    });
});
