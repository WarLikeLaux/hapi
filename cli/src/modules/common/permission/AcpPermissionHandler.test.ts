import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiSessionClient } from '@/api/apiSession';
import type { AgentState } from '@/api/types';
import type { AgentMessage } from '@/agent/types';
import { AcpSdkBackend } from '@/agent/backends/acp/AcpSdkBackend';
import { RPC_METHODS } from '@hapi/protocol/rpcMethods';
import { AcpPermissionHandler } from './AcpPermissionHandler';

// A peer speaks actual JSON-RPC over stdio, including capability negotiation.
// It reports the response it received through the ordinary prompt output.
const peer = `
import { createInterface } from 'node:readline';
let capabilities, promptId, earlyReturn;
const send = (message) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\\n');
const finish = (result) => {
    send({ method: 'session/update', params: { sessionId: 'session-1', update: {
        sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: JSON.stringify(result) }
    } } });
    if (!earlyReturn) send({ id: promptId, result: { stopReason: 'end_turn' } });
};
createInterface({ input: process.stdin }).on('line', (line) => {
    const request = JSON.parse(line);
    if (request.method === 'initialize') {
        capabilities = request.params.clientCapabilities;
        send({ id: request.id, result: { protocolVersion: 1 } });
    } else if (request.method === 'session/new') {
        send({ id: request.id, result: { sessionId: 'session-1' } });
    } else if (request.method === 'session/prompt') {
        promptId = request.id;
        earlyReturn = JSON.parse(request.params.prompt[0].text)._earlyReturn === true;
        if (capabilities.elicitation?.form == null) return finish({ action: 'cancel', missingCapability: true });
        send({ id: 'question-1', method: 'elicitation/create', params: JSON.parse(request.params.prompt[0].text) });
        if (earlyReturn) send({ id: promptId, result: { stopReason: 'end_turn' } });
    } else if (request.id === 'question-1') finish(request.result);
});
`;

const backends: AcpSdkBackend[] = [];
afterEach(async () => {
    await Promise.all(backends.splice(0).map((backend) => backend.disconnect()));
});

async function createHarness() {
    let state: AgentState = { requests: {}, completedRequests: {} };
    let respond: (response: unknown) => Promise<unknown> = async () => {};
    const messages: AgentMessage[] = [];
    const session = {
        rpcHandlerManager: {
            registerHandler(method: string, handler: typeof respond) {
                if (method === RPC_METHODS.Permission) respond = handler;
            }
        },
        updateAgentState(update: (current: AgentState) => AgentState) { state = update(state); }
    } as unknown as ApiSessionClient;
    const backend = new AcpSdkBackend({ command: process.execPath, args: ['--input-type=module', '-e', peer], flavor: 'minimax' });
    backends.push(backend);
    const handler = new AcpPermissionHandler(session, backend, () => 'yolo', (message) => messages.push(message));
    await backend.initialize();
    await backend.newSession({ cwd: process.cwd(), mcpServers: [] });
    return {
        state: () => state,
        messages,
        handler,
        respond: (response: unknown) => respond(response),
        ask: (params: unknown) => {
            const updates: AgentMessage[] = [];
            const completed = backend.prompt('session-1', [{ type: 'text', text: JSON.stringify(params) }], (message) => updates.push(message));
            return { completed, result: () => JSON.parse(updates.filter((message) => message.type === 'text').map((message) => message.text).join('')) };
        }
    };
}

const form = {
    mode: 'form', sessionId: 'session-1', message: 'Configure the project',
    requestedSchema: {
        type: 'object', required: ['approach', 'features', 'details'], properties: {
            approach: { type: 'string', title: 'Which approach?', oneOf: [
                { const: 'safe-id', title: 'Safe', description: 'Keep the current API' },
                { const: 'fast-id', title: 'Fast' }
            ] },
            features: { type: 'array', title: 'Which features?', items: { anyOf: [
                { const: 'api-id', title: 'API' }, { const: 'web-id', title: 'Web' }
            ] } },
            details: { type: 'string', title: 'Additional details' },
            approach__other: { type: 'string', title: 'Other approach' }
        }
    }
};

describe('ACP form elicitation through the permission RPC', () => {
    it('waits for answers in YOLO and returns stable choice IDs, multiple choices and text to the ACP peer', async () => {
        const harness = await createHarness();
        const question = harness.ask(form);
        await vi.waitFor(() => expect(Object.values(harness.state().requests ?? {})).toHaveLength(1));
        const [id, request] = Object.entries(harness.state().requests!)[0]!;
        expect(request).toMatchObject({ tool: 'request_user_input', arguments: { questions: [
            { id: 'approach', options: [{ label: 'Safe', description: 'Keep the current API' }, { label: 'Fast' }] },
            { id: 'features', multiple: true, options: [{ label: 'API' }, { label: 'Web' }] },
            { id: 'details', required: true, options: [] },
            { id: 'approach__other', required: false, options: [] }
        ] } });
        const answers = {
            approach: { answers: ['Fast'] }, features: { answers: ['API', 'Web'] },
            details: { answers: ['user_note: Keep Unicode: Привет'] }, approach__other: { answers: [] }
        };
        await harness.respond({ id, approved: true, answers });
        await question.completed;
        expect(question.result()).toEqual({ action: 'accept', content: {
            approach: 'fast-id', features: ['api-id', 'web-id'], details: 'Keep Unicode: Привет'
        } });
        expect(harness.state().requests).toEqual({});
        expect(harness.state().completedRequests?.[id]).toMatchObject({ status: 'approved', answers });
        expect(harness.messages).toEqual([
            expect.objectContaining({ type: 'tool_call', id, name: 'request_user_input' }),
            expect.objectContaining({ type: 'tool_result', id, output: { answers } })
        ]);
    });

    it.each(['denied', 'abort', 'teardown'] as const)('settles %s without supplying answers', async (decision) => {
        const harness = await createHarness();
        const question = harness.ask(form);
        await vi.waitFor(() => expect(Object.keys(harness.state().requests ?? {})).toHaveLength(1));
        const id = Object.keys(harness.state().requests!)[0]!;
        if (decision === 'teardown') await harness.handler.cancelAll('Session ended');
        else await harness.respond({ id, approved: false, decision });
        await question.completed;
        expect(question.result()).toEqual({ action: decision === 'denied' ? 'decline' : 'cancel' });
        expect(harness.state().requests).toEqual({});
        expect(harness.state().completedRequests?.[id]?.status).toBe(decision === 'denied' ? 'denied' : 'canceled');
    });

    it('keeps a prompt pending when the peer ends its turn before the form is answered', async () => {
        const harness = await createHarness();
        const question = harness.ask({ ...form, _earlyReturn: true });
        let finished = false;
        void question.completed.then(() => { finished = true; });
        await vi.waitFor(() => expect(Object.keys(harness.state().requests ?? {})).toHaveLength(1));
        await new Promise((resolve) => setTimeout(resolve, 700));
        expect(finished).toBe(false);
        const id = Object.keys(harness.state().requests!)[0]!;
        await harness.respond({ id, approved: true, answers: {
            approach: ['Safe'], features: ['API'], details: ['user_note: Keep working']
        } });
        await question.completed;
        expect(question.result()).toEqual({ action: 'accept', content: {
            approach: 'safe-id', features: ['api-id'], details: 'Keep working'
        } });
    });

    it('disambiguates duplicate titles, preserves Other text and converts typed scalar fields', async () => {
        const harness = await createHarness();
        const question = harness.ask({
            ...form, requestedSchema: { type: 'object', properties: {
                choice: { type: 'string', oneOf: [{ const: 'a', title: 'Same' }, { const: 'b', title: 'Same' }] },
                choice__other: { type: 'string' },
                approved: { type: 'boolean' },
                count: { type: 'integer', minimum: 1, maximum: 10 }
            } }
        });
        await vi.waitFor(() => expect(Object.keys(harness.state().requests ?? {})).toHaveLength(1));
        const id = Object.keys(harness.state().requests!)[0]!;
        await harness.respond({ id, approved: true, answers: {
            choice: { answers: ['Same (b)'] }, choice__other: { answers: ['user_note: Custom approach'] },
            approved: { answers: ['false'] }, count: { answers: ['user_note: 3'] }
        } });
        await question.completed;
        expect(question.result()).toEqual({ action: 'accept', content: {
            choice: 'b', choice__other: 'Custom approach', approved: false, count: 3
        } });
    });

    it('keeps MiniMax Other fields inside their questions and maps custom answers back to those fields', async () => {
        const harness = await createHarness();
        const question = harness.ask({
            ...form, requestedSchema: { type: 'object', properties: {
                approach: form.requestedSchema.properties.approach,
                approach__other: { type: 'string', title: 'Which approach? \u2014 Other' },
                features: form.requestedSchema.properties.features,
                features__other: { type: 'string', title: 'Which features? \u2014 Other' },
                details: form.requestedSchema.properties.details
            } }
        });
        await vi.waitFor(() => expect(Object.keys(harness.state().requests ?? {})).toHaveLength(1));
        const [id, request] = Object.entries(harness.state().requests!)[0]!;
        expect(request.arguments).toMatchObject({ questions: [
            { id: 'approach', isOther: true }, { id: 'features', isOther: true, multiple: true }, { id: 'details' }
        ] });
        await harness.respond({ id, approved: true, answers: {
            approach: { answers: ['None of the above', 'user_note: Custom API'] },
            features: { answers: ['API', 'Web'] }, details: { answers: ['user_note: Keep text'] }
        } });
        await question.completed;
        expect(question.result()).toEqual({ action: 'accept', content: {
            approach__other: 'Custom API', features: ['api-id', 'web-id'], details: 'Keep text'
        } });
    });

    it.each([
        { ...form, mode: 'url', url: 'https://example.com' },
        { ...form, sessionId: 'other-session' },
        { ...form, requestedSchema: { type: 'object', properties: { unsupported: { type: 'object' } } } }
    ])('cancels an unsupported or foreign request without showing a misleading form', async (params) => {
        const harness = await createHarness();
        const question = harness.ask(params);
        await question.completed;
        expect(question.result()).toEqual({ action: 'cancel' });
        expect(harness.state().requests).toEqual({});
    });

    it('does not fabricate an answer when an approval lacks required form content', async () => {
        const harness = await createHarness();
        const question = harness.ask(form);
        await vi.waitFor(() => expect(Object.keys(harness.state().requests ?? {})).toHaveLength(1));
        const id = Object.keys(harness.state().requests!)[0]!;
        await harness.respond({ id, approved: true, answers: { approach: ['Invented choice'] } });
        await question.completed;
        expect(question.result()).toEqual({ action: 'cancel' });
        expect(harness.state().completedRequests?.[id]?.status).toBe('canceled');
    });
});
