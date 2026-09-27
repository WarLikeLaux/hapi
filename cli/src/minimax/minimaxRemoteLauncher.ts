import React from 'react';
import { registerAcpSessionTitleSync } from '@/agent/acpSessionTitle';
import { logger } from '@/ui/logger';
import { buildHapiMcpBridge } from '@/codex/utils/buildHapiMcpBridge';
import { convertAgentMessage } from '@/agent/messageConverter';
import type { AgentMessage, McpServerStdio, PromptContent } from '@/agent/types';
import { RemoteLauncherBase, type RemoteLauncherDisplayContext, type RemoteLauncherExitReason } from '@/modules/common/remote/RemoteLauncherBase';
import { AcpPermissionHandler } from '@/modules/common/permission/AcpPermissionHandler';
import { MinimaxDisplay } from '@/ui/ink/MinimaxDisplay';
import type { MinimaxSession } from './session';
import type { PermissionMode } from './types';
import { createMinimaxBackend } from './utils/minimaxBackend';
import { mapMinimaxPermissionMode } from './utils/permissionMode';
import { publishLiveMinimaxCatalog, toMinimaxModelSummaries } from './utils/models';

class MinimaxRemoteLauncher extends RemoteLauncherBase {
    private readonly session: MinimaxSession;
    private readonly model?: string;
    private backend: ReturnType<typeof createMinimaxBackend> | null = null;
    private permissionHandler: AcpPermissionHandler | null = null;
    private happyServer: { stop: () => void } | null = null;
    private abortController = new AbortController();
    private displayModel: string | null = null;
    private displayPermissionMode: PermissionMode | null = null;
    private currentBackendModel: string | null = null;
    private lastAppliedPermissionMode: PermissionMode | undefined = undefined;
    private lastDisplayedToolCall = new Map<string, string>();
    constructor(session: MinimaxSession, opts: { model?: string }) {
        super(process.env.DEBUG ? session.logPath : undefined);
        this.session = session;
        this.model = opts.model;
    }

    public async launch(): Promise<RemoteLauncherExitReason> {
        return this.start({
            onExit: () => this.handleExitFromUi(),
            onSwitchToLocal: () => this.handleSwitchFromUi()
        });
    }

    protected createDisplay(context: RemoteLauncherDisplayContext): React.ReactElement {
        return React.createElement(MinimaxDisplay, context);
    }

    protected async runMainLoop(): Promise<void> {
        const session = this.session;
        const messageBuffer = this.messageBuffer;

        const { server: happyServer, mcpServers } = await buildHapiMcpBridge(session.client, {
            skillLookup: { workingDirectory: session.path, flavor: 'minimax' }
        });
        this.happyServer = happyServer;
        // The MCP bridge above exposes the `change_title` tool by default
        // (buildHapiMcpBridge enableChangeTitle !== false). Tell ApiSession so
        // every fresh remote user prompt gets the hidden title-check block
        // prepended centrally — covers the case the agent otherwise had no
        // static reminder instruction.
        session.client.setHapiTitleToolAvailable(happyServer != null);

        const backend = createMinimaxBackend();
        this.backend = backend;
        registerAcpSessionTitleSync(backend, session.client);

        backend.onStderrError((error) => {
            logger.debug('[minimax-remote] stderr error', error);
            session.sendSessionEvent({ type: 'message', message: error.message });
            messageBuffer.addMessage(error.message, 'status');
        });

        await backend.initialize();

        const resumeSessionId = session.sessionId;
        const acpMcpServers = toAcpMcpServers(mcpServers);
        let acpSessionId: string;
        if (resumeSessionId) {
            try {
                acpSessionId = await backend.loadSession({
                    sessionId: resumeSessionId,
                    cwd: session.path,
                    mcpServers: acpMcpServers
                });
            } catch (error) {
                logger.warn('[minimax-remote] resume failed, starting new session', error);
                session.sendSessionEvent({
                    type: 'message',
                    message: 'MiniMax resume failed; starting a new session.'
                });
                acpSessionId = await backend.newSession({
                    cwd: session.path,
                    mcpServers: acpMcpServers
                });
            }
        } else {
            acpSessionId = await backend.newSession({
                cwd: session.path,
                mcpServers: acpMcpServers
            });
        }
        session.onSessionFound(acpSessionId);

        this.permissionHandler = new AcpPermissionHandler(
            session.client,
            backend,
            () => session.getPermissionMode() as PermissionMode | undefined
        );

        // Model selection goes over the ACP `model` config option. Adopt the
        // agent-reported current model unless the session pinned one; publish
        // the catalog for the web model picker either way.
        const modelOption = backend.getConfigOptionByCategory(acpSessionId, 'model');
        let effectiveModel: string | null = modelOption?.currentValue ?? null;
        if (this.model && modelOption && modelOption.currentValue !== this.model) {
            const applied = await this.applyModel(backend, acpSessionId, this.model);
            if (applied) {
                effectiveModel = this.model;
            }
        }
        this.currentBackendModel = effectiveModel;
        this.publishModelCatalog(backend, acpSessionId);
        if (effectiveModel) {
            this.displayModel = effectiveModel;
            messageBuffer.addMessage(`[MODEL:${effectiveModel}]`, 'system');
        }

        // Push the launch permission mode onto the agent (process-scoped
        // `permissionMode` config option + plan session mode).
        this.lastAppliedPermissionMode = session.getPermissionMode() as PermissionMode | undefined;
        await this.applyPermissionMode(backend, acpSessionId, this.lastAppliedPermissionMode);
        this.applyDisplayMode(this.lastAppliedPermissionMode, effectiveModel ?? undefined);

        this.setupAbortHandlers(session.client.rpcHandlerManager, {
            onAbort: () => this.handleAbort(),
            onSwitch: () => this.handleSwitchRequest()
        });

        const sendReady = () => {
            session.sendSessionEvent({ type: 'ready' });
        };

        while (!this.shouldExit) {
            const batch = await session.queue.waitForMessagesAndGetAsString(this.abortController.signal);
            if (!batch) {
                if (this.abortController.signal.aborted && !this.shouldExit) {
                    continue;
                }
                break;
            }

            if (batch.mode.model && batch.mode.model !== this.currentBackendModel) {
                const switched = await this.applyModel(backend, acpSessionId, batch.mode.model);
                if (switched) {
                    this.currentBackendModel = batch.mode.model;
                } else {
                    batch.mode.model = this.currentBackendModel ?? undefined;
                }
            }

            if (batch.mode.permissionMode && batch.mode.permissionMode !== this.lastAppliedPermissionMode) {
                await this.applyPermissionMode(backend, acpSessionId, batch.mode.permissionMode);
            }

            this.applyDisplayMode(batch.mode.permissionMode, batch.mode.model);
            messageBuffer.addMessage(batch.message, 'user');

            const promptContent: PromptContent[] = [{
                type: 'text',
                text: batch.message
            }];

            // Block here until any in-flight backend prompt from a previous
            // iteration has settled. AcpSdkBackend.processingMessage stays
            // true while a previous `session/prompt` is awaiting its
            // stopReason; trying to dispatch against it makes MiniMax Code
            // ACP reject with "Session already has an active Turn".
            await backend.waitForResponseComplete();

            session.onThinkingChange(true);

            try {
                await this.dispatchWithActiveTurnRetry(
                    backend,
                    acpSessionId,
                    promptContent,
                    batch.items.map((item) => item.localId).filter((id): id is string => Boolean(id))
                );
                void backend.refreshSessionInfo(acpSessionId, session.path);
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                logger.warn('[minimax-remote] prompt failed', { message: errorMessage });
                session.sendSessionEvent({
                    type: 'message',
                    message: `MiniMax prompt failed: ${errorMessage}`
                });
                messageBuffer.addMessage(`MiniMax prompt failed: ${errorMessage}`, 'status');
            } finally {
                session.onThinkingChange(false);
                await this.permissionHandler?.cancelAll('Prompt finished');
                this.publishModelCatalog(backend, acpSessionId);
                if (session.queue.size() === 0 && !this.shouldExit) {
                    sendReady();
                }
            }
        }
    }

    protected async cleanup(): Promise<void> {
        this.clearAbortHandlers(this.session.client.rpcHandlerManager);

        if (this.permissionHandler) {
            await this.permissionHandler.cancelAll('Session ended');
            this.permissionHandler = null;
        }

        if (this.backend) {
            await this.backend.disconnect();
            this.backend = null;
        }

        if (this.happyServer) {
            this.happyServer.stop();
            this.happyServer = null;
        }
    }

    private publishModelCatalog(
        backend: ReturnType<typeof createMinimaxBackend>,
        acpSessionId: string
    ): void {
        const option = backend.getConfigOptionByCategory(acpSessionId, 'model');
        publishLiveMinimaxCatalog({
            models: toMinimaxModelSummaries(option?.options),
            currentModelId: option?.currentValue ?? null
        });
    }

    /**
     * Detects the MiniMax Code "Session already has an active Turn" rejection
     * in an arbitrary thrown value. MiniMax Code's ACP server rejects a new
     * `session/prompt` while a previous turn is still considered active, even
     * when the previous prompt returned successfully a moment earlier — see
     * `cli/src/minimax/minimaxRemoteLauncher.ts` runMainLoop() for the live
     * reasoning. The exact wording comes from the MiniMax runtime and we
     * match on the substring rather than a structured code so the heuristic
     * survives upstream wording tweaks.
     */
    private isActiveTurnError(error: unknown): boolean {
        const message = error instanceof Error ? error.message : String(error);
        return typeof message === 'string' && message.includes('Session already has an active Turn');
    }

    /**
     * Calls `backend.prompt(...)` and, if MiniMax Code rejects it because a
     * previous turn is still considered active, sleeps and retries with a
     * bounded exponential backoff. The error is not transient in the usual
     * sense — the agent's prior `session/prompt` may have returned minutes
     * earlier — but the MiniMax runtime does settle, so a handful of retries
     * with growing delay is enough in practice. Bounded to avoid swallowing
     * real errors forever; surfaces the final attempt's exception to the
     * caller so the existing chat-event reporting still fires.
     */
    private async dispatchWithActiveTurnRetry(
        backend: ReturnType<typeof createMinimaxBackend>,
        acpSessionId: string,
        promptContent: PromptContent[],
        localIds: readonly string[]
    ): Promise<void> {
        const maxAttempts = 5;
        let attempt = 0;
        let delayMs = 200;

        while (true) {
            try {
                await backend.prompt(acpSessionId, promptContent, (message: AgentMessage) => {
                    this.handleAgentMessage(message);
                });
                return;
            } catch (error) {
                if (!this.isActiveTurnError(error) || attempt + 1 >= maxAttempts) {
                    throw error;
                }
                attempt += 1;
                logger.warn('[minimax-remote] active Turn retry', {
                    attempt,
                    delayMs,
                    localIds,
                    message: error instanceof Error ? error.message : String(error)
                });
                await new Promise<void>((resolve) => {
                    const timer = setTimeout(resolve, delayMs);
                    this.abortController.signal.addEventListener(
                        'abort',
                        () => {
                            clearTimeout(timer);
                            resolve();
                        },
                        { once: true }
                    );
                });
                if (this.shouldExit || this.abortController.signal.aborted) {
                    throw error;
                }
                // Re-check that the previous turn actually finished; without
                // this, a fast retry can land on the same still-active turn.
                await backend.waitForResponseComplete();
                delayMs = Math.min(delayMs * 2, 2000);
            }
        }
    }

    /**
     * Applies the HAPI permission mode to the agent. `plan` rides the ACP
     * session mode; the other modes ride the process-scoped `permissionMode`
     * config option (default → Ask, auto → Auto, yolo → Full access).
     */
    private async applyPermissionMode(
        backend: ReturnType<typeof createMinimaxBackend>,
        acpSessionId: string,
        mode: PermissionMode | undefined
    ): Promise<void> {
        const application = mapMinimaxPermissionMode(mode);
        this.lastAppliedPermissionMode = mode;
        try {
            await backend.setMode(acpSessionId, application.acpSessionModeId);
        } catch (error) {
            logger.warn('[minimax-remote] set_mode failed', error);
        }
        if (application.permissionConfigValue === undefined) {
            return;
        }
        const option = backend.getConfigOptionByCategory(acpSessionId, '_permission');
        if (!option) {
            logger.warn('[minimax-remote] agent exposes no permissionMode config option');
            return;
        }
        if (option.currentValue === application.permissionConfigValue) {
            return;
        }
        try {
            await backend.setConfigOption(acpSessionId, option.id, application.permissionConfigValue);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            logger.warn('[minimax-remote] Failed to apply permission mode', error);
            this.session.sendSessionEvent({
                type: 'message',
                message: `Failed to apply permission mode: ${message}.`
            });
        }
    }

    private async applyModel(
        backend: ReturnType<typeof createMinimaxBackend>,
        acpSessionId: string,
        model: string
    ): Promise<boolean> {
        const option = backend.getConfigOptionByCategory(acpSessionId, 'model');
        if (!option) {
            logger.warn(`[minimax-remote] Cannot apply model ${model}: agent exposes no model config option`);
            return false;
        }
        try {
            await backend.setConfigOption(acpSessionId, option.id, model);
            return true;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            logger.warn(`[minimax-remote] Failed to switch model to ${model}`, error);
            this.session.sendSessionEvent({
                type: 'message',
                message: `Failed to switch model to ${model}: ${message}. Continuing with ${this.currentBackendModel ?? 'the agent default'}.`
            });
            return false;
        }
    }

    private handleAgentMessage(message: AgentMessage): void {
        const converted = convertAgentMessage(message, this.currentBackendModel);
        if (converted) {
            this.session.sendAgentMessage(converted);
        }

        switch (message.type) {
            case 'text':
                this.messageBuffer.addMessage(message.text, 'assistant');
                break;
            case 'reasoning':
                this.messageBuffer.addMessage(`[Thinking] ${message.text.substring(0, 100)}...`, 'system');
                break;
            case 'tool_call': {
                const lastName = this.lastDisplayedToolCall.get(message.id);
                if (lastName !== message.name) {
                    this.messageBuffer.addMessage(`Tool call: ${message.name}`, 'tool');
                    this.lastDisplayedToolCall.set(message.id, message.name);
                }
                break;
            }
            case 'tool_result':
                this.messageBuffer.addMessage('Tool result received', 'result');
                break;
            case 'usage':
                break;
            case 'plan':
                this.messageBuffer.addMessage('Plan updated', 'status');
                break;
            case 'error':
                this.messageBuffer.addMessage(message.message, 'status');
                break;
            case 'generated_image':
                this.messageBuffer.addMessage(`Generated image: ${message.fileName}`, 'assistant');
                break;
            case 'turn_complete':
                this.messageBuffer.addMessage('Turn complete', 'status');
                break;
            default: {
                const _exhaustive: never = message;
                return _exhaustive;
            }
        }
    }

    private applyDisplayMode(permissionMode: PermissionMode | undefined, model?: string): void {
        if (permissionMode && permissionMode !== this.displayPermissionMode) {
            this.displayPermissionMode = permissionMode;
            this.messageBuffer.addMessage(`[MODE:${permissionMode}]`, 'system');
        }
        if (model && model !== this.displayModel) {
            this.displayModel = model;
            this.messageBuffer.addMessage(`[MODEL:${model}]`, 'system');
        }
    }

    private async handleAbort(): Promise<void> {
        const backend = this.backend;
        if (backend && this.session.sessionId) {
            await backend.cancelPrompt(this.session.sessionId);
        }
        await this.permissionHandler?.cancelAll('User aborted');
        this.session.sendSessionEvent({ type: 'message', message: 'Session aborted' });
        this.session.queue.reset();
        this.session.onThinkingChange(false);
        this.abortController.abort();
        this.abortController = new AbortController();
        this.messageBuffer.addMessage('Turn aborted', 'status');
    }

    private async handleExitFromUi(): Promise<void> {
        await this.requestExit('exit', () => this.handleAbort());
    }

    private async handleSwitchFromUi(): Promise<void> {
        await this.requestExit('switch', () => this.handleAbort());
    }

    private async handleSwitchRequest(): Promise<void> {
        await this.requestExit('switch', () => this.handleAbort());
    }
}

function toAcpMcpServers(config: Record<string, { command: string; args: string[] }>): McpServerStdio[] {
    return Object.entries(config).map(([name, entry]) => ({
        name,
        command: entry.command,
        args: entry.args,
        env: []
    }));
}

export async function minimaxRemoteLauncher(
    session: MinimaxSession,
    opts: { model?: string }
): Promise<'switch' | 'exit'> {
    const launcher = new MinimaxRemoteLauncher(session, opts);
    return launcher.launch();
}
