import { describe, it, expect, vi } from 'vitest';
import * as claudeSdk from '@/claude/sdk';
import type { SDKMessage } from '@/claude/sdk/types';
import { wrapWithHapiTitleReminder } from '@/modules/common/sessionTitlePrompt';

vi.mock('@/claude/utils/claudeCheckSession', () => ({
    claudeCheckSession: () => true
}));

vi.mock('@/modules/watcher/awaitFileExist', () => ({
    awaitFileExist: async () => true
}));

vi.mock('@/claude/sdk/utils', () => ({
    getDefaultClaudeCodePath: () => '/usr/bin/claude'
}));

const queryMock = vi.fn();

function deferred<T>(): {
    promise: Promise<T>;
    resolve: (value: T) => void;
    reject: (reason?: unknown) => void;
} {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

function createAsyncStream(messages: SDKMessage[]): AsyncIterable<SDKMessage> {
    return {
        async *[Symbol.asyncIterator]() {
            for (const message of messages) {
                await Promise.resolve();
                yield message;
            }
        }
    };
}

function createQueryThatMirrorsPromptErrors(messages: SDKMessage[]) {
    return ({ prompt }: { prompt: AsyncIterable<unknown> }) => ({
        async *[Symbol.asyncIterator]() {
            const promptIterator = prompt[Symbol.asyncIterator]();

            await promptIterator.next();

            for (const message of messages) {
                await Promise.resolve();
                yield message;
            }

            await promptIterator.next();
        }
    });
}

async function waitFor(condition: () => boolean, timeoutMs = 300, intervalMs = 10): Promise<void> {
    const startedAt = Date.now();
    while (!condition()) {
        if (Date.now() - startedAt > timeoutMs) {
            throw new Error('Timed out waiting for condition');
        }
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
}

describe('claudeRemote async message handling', () => {
    it.each([0, 1])('forwards native /recap without the hidden title reminder at prompt index %s', async recapIndex => {
        const querySpy = vi.spyOn(claudeSdk, 'query').mockImplementation(queryMock as typeof claudeSdk.query);
        const { claudeRemote } = await import('./claudeRemote');
        const prompts: unknown[] = [];
        const recap = { type: 'assistant', message: { role: 'assistant', model: '<synthetic>',
            content: [{ type: 'text', text: 'Inspected the protocol. Next: display the native recap.' }] } } as unknown as SDKMessage;
        queryMock.mockImplementationOnce(({ prompt }: { prompt: AsyncIterable<unknown> }) => ({
            async *[Symbol.asyncIterator]() {
                let index = 0;
                for await (const message of prompt) {
                    prompts.push(message);
                    if (index++ === recapIndex) yield recap;
                    yield { type: 'result', subtype: 'success', num_turns: 0, local_command: 'recap' } as unknown as SDKMessage;
                }
            }
        }));
        const received: SDKMessage[] = [];
        let index = 0;
        try {
            await claudeRemote({ sessionId: 'session-1', path: process.cwd(), mcpServers: {}, claudeEnvVars: {},
                claudeArgs: [], allowedTools: [], hookSettingsPath: '/tmp/hook.json',
                canCallTool: async () => ({ behavior: 'allow', updatedInput: {} }),
                nextMessage: async () => index >= 2 ? null : { message: index++ === recapIndex
                    ? wrapWithHapiTitleReminder('Keep the title aligned.', '/recap') : 'Review this project', mode: { permissionMode: 'default' } },
                onReady: () => {}, isAborted: () => false, onSessionFound: () => {}, onMessage: message => { received.push(message); } });
            expect(prompts).toHaveLength(2);
            expect(prompts[recapIndex]).toMatchObject({ type: 'user', message: { content: '/recap' } });
            expect(received).toContainEqual(recap);
        } finally { queryMock.mockReset(); querySpy.mockRestore(); }
    });

    // CI occasionally exceeds the default 5s under load (unrelated to job work).
    it('reports the initial normal message once after the first result', { timeout: 15_000 }, async () => {
        const querySpy = vi.spyOn(claudeSdk, 'query').mockImplementation(queryMock as typeof claudeSdk.query);
        const { claudeRemote } = await import('./claudeRemote');
        const onFirstResult = vi.fn();

        queryMock.mockReturnValueOnce(createAsyncStream([
            { type: 'result', subtype: 'success' } as unknown as SDKMessage,
            { type: 'result', subtype: 'success' } as unknown as SDKMessage
        ]));

        let nextCallCount = 0;
        try {
            await claudeRemote({
                sessionId: 'session-1',
                path: process.cwd(),
                mcpServers: {},
                claudeEnvVars: {},
                claudeArgs: [],
                allowedTools: [],
                hookSettingsPath: '/tmp/hook.json',
                canCallTool: async () => ({ behavior: 'allow', updatedInput: {} }),
                nextMessage: async () => nextCallCount++ === 0
                    ? { message: 'Review this project', mode: { permissionMode: 'default' } }
                    : null,
                onReady: () => {},
                isAborted: () => false,
                onSessionFound: () => {},
                onMessage: () => {},
                onFirstResult
            });

            expect(onFirstResult).toHaveBeenCalledTimes(1);
            expect(onFirstResult).toHaveBeenCalledWith('Review this project');
        } finally {
            queryMock.mockReset();
            querySpy.mockRestore();
        }
    });

    it('waits for async onReady work before completing the result stream', async () => {
        const querySpy = vi.spyOn(claudeSdk, 'query').mockImplementation(queryMock as typeof claudeSdk.query);
        const { claudeRemote } = await import('./claudeRemote');
        const releaseReady = deferred<void>();
        queryMock.mockReturnValueOnce(createAsyncStream([
            { type: 'result', subtype: 'success' } as unknown as SDKMessage
        ]));

        let nextCallCount = 0;
        let readyStarted = false;
        let settled = false;
        try {
            const runPromise = claudeRemote({
                sessionId: 'session-1',
                path: process.cwd(),
                mcpServers: {},
                claudeEnvVars: {},
                claudeArgs: [],
                allowedTools: [],
                hookSettingsPath: '/tmp/hook.json',
                canCallTool: async () => ({ behavior: 'allow', updatedInput: {} }),
                nextMessage: async () => nextCallCount++ === 0
                    ? { message: 'Review this project', mode: { permissionMode: 'default' } }
                    : null,
                onReady: async () => {
                    readyStarted = true;
                    await releaseReady.promise;
                },
                isAborted: () => false,
                onSessionFound: () => {},
                onMessage: () => {}
            });
            void runPromise.finally(() => { settled = true; });

            await waitFor(() => readyStarted);
            await new Promise((resolve) => setTimeout(resolve, 0));
            expect(settled).toBe(false);

            releaseReady.resolve();
            await runPromise;
        } finally {
            releaseReady.resolve();
            queryMock.mockReset();
            querySpy.mockRestore();
        }
    });

    it('continues consuming assistant messages even when next user message is pending', async () => {
        const querySpy = vi.spyOn(claudeSdk, 'query').mockImplementation(queryMock as typeof claudeSdk.query);
        const { claudeRemote } = await import('./claudeRemote');
        const pendingNext = deferred<{ message: string; mode: { permissionMode: 'default' } } | null>();
        const received: SDKMessage[] = [];

        const sdkMessages: SDKMessage[] = [
            {
                type: 'assistant',
                message: {
                    role: 'assistant',
                    content: [{ type: 'text', text: 'A_1' }]
                }
            } as unknown as SDKMessage,
            {
                type: 'result',
                subtype: 'success',
                num_turns: 1,
                total_cost_usd: 0,
                duration_ms: 1,
                duration_api_ms: 1,
                is_error: false,
                session_id: 's-1'
            } as unknown as SDKMessage,
            {
                type: 'assistant',
                message: {
                    role: 'assistant',
                    content: [{ type: 'text', text: 'A_2' }]
                }
            } as unknown as SDKMessage
        ];

        queryMock.mockReturnValueOnce(createAsyncStream(sdkMessages));

        let nextCallCount = 0;
        const runPromise = claudeRemote({
            sessionId: 'session-1',
            path: process.cwd(),
            mcpServers: {},
            claudeEnvVars: {},
            claudeArgs: [],
            allowedTools: [],
            hookSettingsPath: '/tmp/hook.json',
            canCallTool: async () => ({ behavior: 'allow', updatedInput: {} }),
            nextMessage: async () => {
                nextCallCount += 1;
                if (nextCallCount === 1) {
                    return { message: 'A', mode: { permissionMode: 'default' } };
                }
                return await pendingNext.promise;
            },
            onReady: () => {},
            isAborted: () => false,
            onSessionFound: () => {},
            onMessage: (message) => {
                received.push(message);
            },
            onCompletionEvent: () => {},
            onSessionReset: () => {}
        });

        await waitFor(() => received.length >= 3);
        expect(received.map((m) => m.type)).toEqual(['assistant', 'result', 'assistant']);

        try {
            pendingNext.resolve(null);
            await runPromise;
        } finally {
            queryMock.mockReset();
            querySpy.mockRestore();
        }
    }, 15_000);

    it('sets thinking to true when an autonomous assistant message arrives after result', async () => {
        const querySpy = vi.spyOn(claudeSdk, 'query').mockImplementation(queryMock as typeof claudeSdk.query);
        const { claudeRemote } = await import('./claudeRemote');
        const pendingNext = deferred<{ message: string; mode: { permissionMode: 'default' } } | null>();
        const thinkingStates: boolean[] = [];

        const sdkMessages: SDKMessage[] = [
            {
                type: 'assistant',
                message: { role: 'assistant', content: [{ type: 'text', text: 'Turn 1' }] }
            } as unknown as SDKMessage,
            {
                type: 'result',
                subtype: 'success',
                num_turns: 1,
                total_cost_usd: 0,
                duration_ms: 1,
                duration_api_ms: 1,
                is_error: false,
                session_id: 's-1'
            } as unknown as SDKMessage,
            {
                type: 'assistant',
                message: { role: 'assistant', content: [{ type: 'text', text: 'Autonomous Turn 2' }] }
            } as unknown as SDKMessage
        ];

        queryMock.mockReturnValueOnce(createAsyncStream(sdkMessages));

        let nextCallCount = 0;
        const runPromise = claudeRemote({
            sessionId: 'session-1',
            path: process.cwd(),
            mcpServers: {},
            claudeEnvVars: {},
            claudeArgs: [],
            allowedTools: [],
            hookSettingsPath: '/tmp/hook.json',
            canCallTool: async () => ({ behavior: 'allow', updatedInput: {} }),
            nextMessage: async () => {
                nextCallCount += 1;
                if (nextCallCount === 1) {
                    return { message: 'A', mode: { permissionMode: 'default' } };
                }
                return await pendingNext.promise;
            },
            onThinkingChange: (thinking) => {
                thinkingStates.push(thinking);
            },
            onReady: () => {},
            isAborted: () => false,
            onSessionFound: () => {},
            onMessage: () => {}
        });

        await waitFor(() => thinkingStates.length >= 3);
        expect(thinkingStates.slice(0, 3)).toEqual([true, false, true]);

        try {
            pendingNext.resolve(null);
            await runPromise;
        } finally {
            queryMock.mockReset();
            querySpy.mockRestore();
        }
    }, 15_000);

    it('handles rejected next user message fetch without unhandled rejection', async () => {
        const querySpy = vi.spyOn(claudeSdk, 'query').mockImplementation(queryMock as typeof claudeSdk.query);
        const { claudeRemote } = await import('./claudeRemote');
        const received: SDKMessage[] = [];
        const unhandled: unknown[] = [];
        const onUnhandled = (reason: unknown) => {
            unhandled.push(reason);
        };
        process.on('unhandledRejection', onUnhandled);

        const sdkMessages: SDKMessage[] = [
            {
                type: 'assistant',
                message: {
                    role: 'assistant',
                    content: [{ type: 'text', text: 'A_1' }]
                }
            } as unknown as SDKMessage,
            {
                type: 'result',
                subtype: 'success',
                num_turns: 1,
                total_cost_usd: 0,
                duration_ms: 1,
                duration_api_ms: 1,
                is_error: false,
                session_id: 's-1'
            } as unknown as SDKMessage
        ];

        queryMock.mockImplementationOnce(createQueryThatMirrorsPromptErrors(sdkMessages));

        let nextCallCount = 0;
        const runPromise = claudeRemote({
            sessionId: 'session-1',
            path: process.cwd(),
            mcpServers: {},
            claudeEnvVars: {},
            claudeArgs: [],
            allowedTools: [],
            hookSettingsPath: '/tmp/hook.json',
            canCallTool: async () => ({ behavior: 'allow', updatedInput: {} }),
            nextMessage: async () => {
                nextCallCount += 1;
                if (nextCallCount === 1) {
                    return { message: 'A', mode: { permissionMode: 'default' } };
                }
                throw new Error('next message failed');
            },
            onReady: () => {},
            isAborted: () => false,
            onSessionFound: () => {},
            onMessage: (message) => {
                received.push(message);
            },
            onCompletionEvent: () => {},
            onSessionReset: () => {}
        });

        try {
            await expect(runPromise).rejects.toThrow('next message failed');
            await new Promise((resolve) => setTimeout(resolve, 0));
            expect(received.map((m) => m.type)).toEqual(['assistant', 'result']);
            expect(unhandled).toEqual([]);
        } finally {
            queryMock.mockReset();
            querySpy.mockRestore();
            process.off('unhandledRejection', onUnhandled);
        }
    });

    it('treats AbortError from scheduled next user message fetch as graceful shutdown', async () => {
        const querySpy = vi.spyOn(claudeSdk, 'query').mockImplementation(queryMock as typeof claudeSdk.query);
        const { claudeRemote } = await import('./claudeRemote');
        const received: SDKMessage[] = [];
        const unhandled: unknown[] = [];
        const onUnhandled = (reason: unknown) => {
            unhandled.push(reason);
        };
        process.on('unhandledRejection', onUnhandled);

        const sdkMessages: SDKMessage[] = [
            {
                type: 'assistant',
                message: {
                    role: 'assistant',
                    content: [{ type: 'text', text: 'A_1' }]
                }
            } as unknown as SDKMessage,
            {
                type: 'result',
                subtype: 'success',
                num_turns: 1,
                total_cost_usd: 0,
                duration_ms: 1,
                duration_api_ms: 1,
                is_error: false,
                session_id: 's-1'
            } as unknown as SDKMessage
        ];

        queryMock.mockReturnValueOnce(createAsyncStream(sdkMessages));

        let nextCallCount = 0;
        const runPromise = claudeRemote({
            sessionId: 'session-1',
            path: process.cwd(),
            mcpServers: {},
            claudeEnvVars: {},
            claudeArgs: [],
            allowedTools: [],
            hookSettingsPath: '/tmp/hook.json',
            canCallTool: async () => ({ behavior: 'allow', updatedInput: {} }),
            nextMessage: async () => {
                nextCallCount += 1;
                if (nextCallCount === 1) {
                    return { message: 'A', mode: { permissionMode: 'default' } };
                }
                throw new claudeSdk.AbortError('aborted');
            },
            onReady: () => {},
            isAborted: () => false,
            onSessionFound: () => {},
            onMessage: (message) => {
                received.push(message);
            },
            onCompletionEvent: () => {},
            onSessionReset: () => {}
        });

        try {
            await runPromise;
            await new Promise((resolve) => setTimeout(resolve, 0));
            expect(received.map((m) => m.type)).toEqual(['assistant', 'result']);
            expect(unhandled).toEqual([]);
        } finally {
            queryMock.mockReset();
            querySpy.mockRestore();
            process.off('unhandledRejection', onUnhandled);
        }
    });
});

describe('claudeRemote /compact result reporting', () => {
    const resultMessage = {
        type: 'result',
        subtype: 'success',
        num_turns: 1,
        total_cost_usd: 0,
        duration_ms: 1,
        duration_api_ms: 1,
        is_error: false,
        session_id: 's-1'
    } as unknown as SDKMessage;

    async function runCompact(sdkMessages: SDKMessage[]): Promise<string[]> {
        const querySpy = vi.spyOn(claudeSdk, 'query').mockImplementation(queryMock as typeof claudeSdk.query);
        const { claudeRemote } = await import('./claudeRemote');
        const completionEvents: string[] = [];

        queryMock.mockReturnValueOnce(createAsyncStream(sdkMessages));

        let nextCallCount = 0;
        try {
            await claudeRemote({
                sessionId: 'session-1',
                path: process.cwd(),
                mcpServers: {},
                claudeEnvVars: {},
                claudeArgs: [],
                allowedTools: [],
                hookSettingsPath: '/tmp/hook.json',
                canCallTool: async () => ({ behavior: 'allow', updatedInput: {} }),
                nextMessage: async () => {
                    nextCallCount += 1;
                    if (nextCallCount === 1) {
                        return { message: '/compact', mode: { permissionMode: 'default' } };
                    }
                    return null;
                },
                onReady: (completionEvent) => {
                    if (completionEvent) completionEvents.push(completionEvent);
                },
                isAborted: () => false,
                onSessionFound: () => {},
                onMessage: () => {},
                onCompletionEvent: (message) => {
                    completionEvents.push(message);
                },
                onSessionReset: () => {}
            });
        } finally {
            queryMock.mockReset();
            querySpy.mockRestore();
        }

        return completionEvents;
    }

    it('reports the failure reason when the SDK says the compaction failed', async () => {
        // Shape taken from a real session: the SDK emits a 'compacting' status
        // first, then a second status carrying the outcome.
        const completionEvents = await runCompact([
            {
                type: 'system',
                subtype: 'status',
                status: 'compacting',
                session_id: 's-1',
                uuid: 'u-1'
            } as unknown as SDKMessage,
            {
                type: 'system',
                subtype: 'status',
                status: null,
                compact_result: 'failed',
                compact_error: 'Not enough messages to compact.',
                session_id: 's-1',
                uuid: 'u-2'
            } as unknown as SDKMessage,
            resultMessage
        ]);

        expect(completionEvents).toContain('Compaction started');
        expect(completionEvents.some((event) => event.includes('Not enough messages to compact.'))).toBe(true);
        expect(completionEvents).not.toContain('Compaction completed');
    }, 15_000);

    it('still reports success when no failure status arrives', async () => {
        const completionEvents = await runCompact([
            {
                type: 'system',
                subtype: 'status',
                status: 'compacting',
                session_id: 's-1',
                uuid: 'u-1'
            } as unknown as SDKMessage,
            resultMessage
        ]);

        expect(completionEvents).toEqual(['Compaction started', 'Compaction completed']);
    }, 15_000);

    it('hands compact completion to the ready phase so the result carrier can flush first', async () => {
        const querySpy = vi.spyOn(claudeSdk, 'query').mockImplementation(queryMock as typeof claudeSdk.query);
        const { claudeRemote } = await import('./claudeRemote');
        const wireOrder: string[] = [];
        const queued: string[] = [];
        queryMock.mockReturnValueOnce(createAsyncStream([resultMessage]));

        let nextCallCount = 0;
        try {
            await claudeRemote({
                sessionId: 'session-1', path: process.cwd(), mcpServers: {}, claudeEnvVars: {},
                claudeArgs: [], allowedTools: [], hookSettingsPath: '/tmp/hook.json',
                canCallTool: async () => ({ behavior: 'allow', updatedInput: {} }),
                nextMessage: async () => nextCallCount++ === 0
                    ? { message: '/compact', mode: { permissionMode: 'default' } }
                    : null,
                onReady: (completionEvent) => {
                    wireOrder.push(...queued.splice(0));
                    if (completionEvent) wireOrder.push(completionEvent);
                    wireOrder.push('ready');
                },
                isAborted: () => false,
                onSessionFound: () => {},
                onMessage: (message) => {
                    if (message.type === 'result') queued.push('result');
                },
                onCompletionEvent: (message) => {
                    if (message !== 'Compaction started') wireOrder.push(message);
                }
            });
        } finally {
            queryMock.mockReset();
            querySpy.mockRestore();
        }

        expect(wireOrder).toEqual(['result', 'Compaction completed', 'ready']);
    }, 15_000);
});
