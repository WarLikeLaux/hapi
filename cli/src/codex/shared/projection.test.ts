import { describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import type { ApiSessionClient } from '@/api/apiSession';
import { SharedCodexProjection, inputText } from './projection';
import { codexPlanProposalId } from './plan';

// Several tests read vi.fn() call history through the session client, so the
// cast must keep the mock visible instead of erasing it.
type SessionClient = ApiSessionClient & { updateAgentState: Mock };

describe('shared history projection', () => {
    it.each([undefined, 'root'])('persists proposals without approval and replays the same IDs (parent: %s)', async parentThreadId => {
        const send = vi.fn();
        const session = { getMetadata: () => ({}), updateAgentState: vi.fn(), sendAgentMessage: send } as unknown as SessionClient;
        const projection = new SharedCodexProjection(session, 'thread', async () => {}, parentThreadId);
        const item = { id: 'plan', type: 'plan', text: '# Final plan' };
        const params = { threadId: 'thread', turnId: 'turn', item };
        await projection.notification('item/completed', { ...params, item: { id: 'before', type: 'agentMessage', text: 'Preface' } });
        await projection.notification('item/started', params);
        await projection.notification('item/plan/delta', { ...params, itemId: 'plan', delta: '# Provisional' });
        await projection.notification('item/completed', params);
        await projection.notification('item/completed', params);
        await projection.notification('item/completed', { ...params, item: { id: 'after', type: 'agentMessage', text: 'Postscript' } });
        expect(send).toHaveBeenCalledTimes(4);
        const bodies = send.mock.calls.map(([body]) => parentThreadId ? body.message : body);
        const callId = codexPlanProposalId('thread', 'turn', 'plan');
        expect(bodies).toEqual([
            expect.objectContaining({ type: 'message', message: 'Preface' }),
            expect.objectContaining({ type: 'tool-call', name: 'ExitPlanMode', callId, input: { plan: '# Final plan' } }),
            expect.objectContaining({ type: 'tool-call-result', callId, output: null }),
            expect.objectContaining({ type: 'message', message: 'Postscript' })
        ]);
        const original = send.mock.calls.slice(1, 3);
        projection.reset(); send.mockClear();
        await projection.history({ turns: [{ id: 'turn', status: 'completed', items: [item] }] });
        expect(send.mock.calls).toEqual(original);
    });

    it('waits for final proposal content after an active snapshot', async () => {
        const send = vi.fn();
        const session = { getMetadata: () => ({}), updateAgentState: vi.fn(), sendAgentMessage: send } as unknown as SessionClient;
        const projection = new SharedCodexProjection(session, 'thread', async () => {});
        await projection.history({ turns: [{ id: 'turn', status: 'inProgress', items: [{ id: 'plan', type: 'plan', text: 'partial' }] }] });
        expect(send).not.toHaveBeenCalled();
        await projection.notification('item/completed', { threadId: 'thread', turnId: 'turn', item: { id: 'plan', type: 'plan', text: 'final' } });
        expect(send.mock.calls[0][0]).toMatchObject({ input: { plan: 'final' } });
        expect(send.mock.calls[1][0]).toMatchObject({ output: null });
    });

    it.each([undefined, 'root'])('emits canonical error flags for tools (parent: %s)', async parentThreadId => {
        const send = vi.fn();
        const session = { getMetadata: () => ({}), updateAgentState: vi.fn(), sendAgentMessage: send } as unknown as SessionClient;
        const projection = new SharedCodexProjection(session, 'thread', async () => {}, parentThreadId);
        for (const failed of [true, false]) {
            for (const type of ['mcpToolCall', 'collabAgentToolCall']) {
                const item = { id: `${type}-${failed}`, type, server: 'test', tool: 'spawnAgent',
                    status: failed ? 'failed' : 'completed', error: failed ? { message: 'failed' } : null,
                    result: { Ok: 'done' } };
                await projection.notification('item/completed', { threadId: 'thread', turnId: 'turn', item });
                const body = send.mock.lastCall?.[0];
                const result = parentThreadId ? body.message : body;
                expect(result).toMatchObject({ type: 'tool-call-result', is_error: failed });
                expect(result).not.toHaveProperty('isError');
            }
        }
    });
    it('keeps each turn model through settings changes, reconnect replay and rerouting', async () => {
        const send = vi.fn();
        const session = { getMetadata: () => ({}), updateAgentState: vi.fn(), sendAgentMessage: send } as unknown as SessionClient;
        const projection = new SharedCodexProjection(session, 'thread', async () => {});
        await projection.notification('turn/started', { threadId: 'thread', turn: { id: 'old' } }, 'model-a');
        await projection.notification('turn/started', { threadId: 'thread', turn: { id: 'new' } }, 'model-b');
        projection.reset();
        // A replayed start must not rewrite the executing model either.
        await projection.notification('turn/started', { threadId: 'thread', turn: { id: 'old' } }, 'model-b');
        const usage = async (turnId: string) => projection.notification('thread/tokenUsage/updated', {
            threadId: 'thread', turnId, tokenUsage: { last: { inputTokens: 12, outputTokens: 3 } }
        }, 'model-b');
        await usage('old');
        await projection.notification('model/rerouted', { threadId: 'thread', turnId: 'new', fromModel: 'model-b', toModel: 'model-c', reason: 'test' });
        await usage('new');
        const events = send.mock.calls.map(([body]) => body).filter(body => body.type === 'token_count');
        expect(events.map(body => body.model)).toEqual(['model-a', 'model-c']);
    });
    it('keeps image-only native inputs visible without embedding data URLs', () => {
        expect(inputText([{ type: 'image', url: 'data:image/png;base64,large' }])).toBe('[Image]');
        expect(inputText([{ type: 'localImage', path: '/tmp/image.png' }])).toBe('[Image: /tmp/image.png]');
    });
    it('replays after hub reconnect using the same durable local id', async () => {
        const send = vi.fn(); const session = { getMetadata: () => ({}), updateAgentState: vi.fn(), sendAgentMessage: send } as unknown as SessionClient;
        const projection = new SharedCodexProjection(session, 'thread', async () => {});
        const snapshot = { turns: [{ id: 'turn', status: 'completed', items: [{ id: 'item', type: 'agentMessage', text: 'complete' }] }] };
        await projection.history(snapshot); projection.reset(); await projection.history(snapshot);
        expect(send).toHaveBeenCalledTimes(2); expect(send.mock.calls[0]).toEqual(send.mock.calls[1]);
    });
    it('primes existing history without publishing it, then emits only new events', async () => {
        const send = vi.fn(); const user = vi.fn(); const committed = vi.fn(async () => {});
        const session = { getMetadata: () => ({}), updateAgentState: vi.fn(), sendAgentMessage: send, sendUserMessage: user,
            updateMetadata: vi.fn() } as unknown as SessionClient;
        const projection = new SharedCodexProjection(session, 'thread', committed);
        const snapshot = { turns: [{ id: 'old-turn', status: 'completed', items: [
            { id: 'old-user', type: 'userMessage', clientId: 'old-client', content: [{ type: 'text', text: 'old prompt' }] },
            { id: 'old-answer', type: 'agentMessage', text: 'old answer' }
        ] }] };
        await projection.history(snapshot, false);
        expect(send).not.toHaveBeenCalled(); expect(user).not.toHaveBeenCalled(); expect(committed).not.toHaveBeenCalled();
        await projection.notification('item/completed', { threadId: 'thread', turnId: 'new-turn',
            item: { id: 'new-answer', type: 'agentMessage', text: 'new answer' } });
        expect(send).toHaveBeenCalledOnce();
        expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: 'message', message: 'new answer' }), expect.any(String));
    });
    it('does not settle an active snapshot under the final message id', async () => {
        const send = vi.fn();
        const session = { getMetadata: () => ({}), updateAgentState: vi.fn(), sendAgentMessage: send } as unknown as SessionClient;
        const projection = new SharedCodexProjection(session, 'thread', async () => {});
        await projection.history({ turns: [{ id: 'turn', status: 'inProgress', items: [{ id: 'item', type: 'agentMessage', text: 'partial' }] }] });
        expect(send).not.toHaveBeenCalled();
        await projection.notification('item/completed', { threadId: 'thread', turnId: 'turn', item: { id: 'item', type: 'agentMessage', text: 'complete' } });
        expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: 'message', message: 'complete' }), expect.any(String));
    });
    it('routes descendant answers into a scoped agent trace, not a root message', async () => {
        const send = vi.fn(); const user = vi.fn(); const committed = vi.fn(async () => {});
        const session = { getMetadata: () => ({}), updateAgentState: vi.fn(), sendAgentMessage: send, sendUserMessage: user } as unknown as SessionClient;
        const projection = new SharedCodexProjection(session, 'child', committed, 'root');
        await projection.notification('item/completed', { threadId: 'child', turnId: 'turn', item: { id: 'item', type: 'agentMessage', text: 'child answer' } });
        expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: 'agent-run-trace', agentId: 'child', message: expect.objectContaining({ message: 'child answer' }) }), expect.any(String));
        await projection.notification('item/completed', { threadId: 'child', turnId: 'turn', item: { id: 'prompt', type: 'userMessage', content: [{ type: 'text', text: 'child prompt' }], clientId: 'cid' } });
        expect(user).not.toHaveBeenCalled(); expect(committed).not.toHaveBeenCalled();
    });

    it('does not resurrect questions from older turns on replay', async () => {
        const send = vi.fn();
        const session = { getMetadata: () => ({}), updateAgentState: vi.fn(), sendAgentMessage: send } as unknown as SessionClient;
        const projection = new SharedCodexProjection(session, 'thread', async () => {});
        const old = { id: 'old-q', type: 'agentMessage', delivery: 'async', questions: [{ title: 'Old question' }] };
        const fresh = { id: 'fresh-q', type: 'agentMessage', delivery: 'async', questions: [{ title: 'Fresh question' }] };
        await projection.history({ turns: [
            { id: 'turn-1', status: 'completed', items: [old] },
            { id: 'turn-2', status: 'completed', items: [fresh] }
        ] });
        let state: { codexAsyncQuestions?: Record<string, unknown> } = {
            codexAsyncQuestions: { 'codex-async-question:thread:old-q': { tool: 'request_user_input_async' } }
        };
        for (const [handler] of session.updateAgentState.mock.calls) state = handler(state);
        expect(Object.keys(state.codexAsyncQuestions ?? {})).toEqual(['codex-async-question:thread:fresh-q']);
    });

    it('keeps the newest completed turn question pending until a newer turn exists', async () => {
        const send = vi.fn();
        const session = { getMetadata: () => ({}), updateAgentState: vi.fn(), sendAgentMessage: send } as unknown as SessionClient;
        const projection = new SharedCodexProjection(session, 'thread', async () => {});
        const only = { id: 'only-q', type: 'agentMessage', delivery: 'async', questions: [{ title: 'Only question' }] };
        await projection.history({ turns: [{ id: 'turn-1', status: 'completed', items: [only] }] });
        let state: { codexAsyncQuestions?: Record<string, unknown> } = {};
        for (const [handler] of session.updateAgentState.mock.calls) state = handler(state);
        expect(Object.keys(state.codexAsyncQuestions ?? {})).toEqual(['codex-async-question:thread:only-q']);
    });

    it('never re-adds a question dismissed in metadata', async () => {
        const send = vi.fn();
        const metadata = { codexDismissedAsyncQuestions: { 'codex-async-question:thread:q': 123 } };
        const session = { getMetadata: () => metadata, updateAgentState: vi.fn(), sendAgentMessage: send } as unknown as SessionClient;
        const projection = new SharedCodexProjection(session, 'thread', async () => {});
        const question = { id: 'q', type: 'agentMessage', delivery: 'async', questions: [{ title: 'Question' }] };
        await projection.history({ turns: [{ id: 'turn', status: 'completed', items: [question] }] });
        let state: { codexAsyncQuestions?: Record<string, unknown> } = {
            codexAsyncQuestions: { 'codex-async-question:thread:q': { tool: 'request_user_input_async' } }
        };
        for (const [handler] of session.updateAgentState.mock.calls) state = handler(state);
        expect(state.codexAsyncQuestions).toEqual({});
    });

    it('drops a question dismissed in-process and keeps it dropped after replay', async () => {
        const send = vi.fn();
        const session = { getMetadata: () => ({}), updateAgentState: vi.fn(), sendAgentMessage: send } as unknown as SessionClient;
        const projection = new SharedCodexProjection(session, 'thread', async () => {});
        const question = { id: 'q', type: 'agentMessage', delivery: 'async', questions: [{ title: 'Question' }] };
        const snapshot = { turns: [{ id: 'turn', status: 'completed', items: [question] }] };
        await projection.history(snapshot);
        projection.dismissAsyncQuestion('codex-async-question:thread:q');
        let state: { codexAsyncQuestions?: Record<string, unknown> } = {
            codexAsyncQuestions: { 'codex-async-question:thread:q': { tool: 'request_user_input_async' } }
        };
        for (const [handler] of session.updateAgentState.mock.calls) state = handler(state);
        expect(state.codexAsyncQuestions).toEqual({});
        projection.reset();
        session.updateAgentState.mockClear();
        await projection.history(snapshot);
        // The hub already dropped the entry at dismiss time; replay must not
        // call back with an add for the dismissed question.
        state = {};
        for (const [handler] of session.updateAgentState.mock.calls) state = handler(state);
        expect(state.codexAsyncQuestions?.['codex-async-question:thread:q']).toBeUndefined();
    });

    it('expires older-turn questions once a newer turn starts live', async () => {
        const send = vi.fn();
        const session = { getMetadata: () => ({}), updateAgentState: vi.fn(), sendAgentMessage: send } as unknown as SessionClient;
        const projection = new SharedCodexProjection(session, 'thread', async () => {});
        const question = { id: 'q', type: 'agentMessage', delivery: 'async', questions: [{ title: 'Question' }] };
        await projection.notification('item/completed', { threadId: 'thread', turnId: 'turn-1', item: question });
        let state: { codexAsyncQuestions?: Record<string, unknown> } = {};
        for (const [handler] of session.updateAgentState.mock.calls) state = handler(state);
        expect(Object.keys(state.codexAsyncQuestions ?? {})).toEqual(['codex-async-question:thread:q']);
        // A sibling-thread turn must not expire them.
        await projection.notification('turn/started', { threadId: 'child', turnId: 'turn-2' });
        state = {};
        for (const [handler] of session.updateAgentState.mock.calls) state = handler(state);
        expect(Object.keys(state.codexAsyncQuestions ?? {})).toEqual(['codex-async-question:thread:q']);
        await projection.notification('turn/started', { threadId: 'thread', turnId: 'turn-2' });
        state = {};
        for (const [handler] of session.updateAgentState.mock.calls) state = handler(state);
        expect(state.codexAsyncQuestions).toEqual({});
    });
});
