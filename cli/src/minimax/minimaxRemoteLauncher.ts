import React from 'react';
import { RPC_METHODS } from '@hapi/protocol/rpcMethods';
import { isAcpIndeterminateError } from '@/agent/backends/acp/AcpStdioTransport';
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

type MinimaxTurn = {
    signal: AbortSignal;
    modeHash: string;
    acceptingSteers: boolean;
    completed: Promise<void>;
    steers: Set<Promise<unknown>>;
};

class MinimaxRemoteLauncher extends RemoteLauncherBase {
    private readonly session: MinimaxSession;
    private readonly model?: string;
    private backend: ReturnType<typeof createMinimaxBackend> | null = null;
    private permissionHandler: AcpPermissionHandler | null = null;
    private happyServer: { stop: () => void } | null = null;
    private abortController = new AbortController();
    private activeTurn: MinimaxTurn | null = null;
    private abortInFlight: Promise<void> | null = null;
    private needsBackendRestart = false;
    private acpMcpServers: McpServerStdio[] = [];
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

        this.acpMcpServers = toAcpMcpServers(mcpServers);
        await this.initializeBackend();

        this.setupAbortHandlers(session.client.rpcHandlerManager, {
            onAbort: () => this.handleAbort(),
            onSwitch: () => this.handleSwitchRequest()
        });

        const sendReady = () => {
            session.sendSessionEvent({ type: 'ready' });
        };

        session.client.rpcHandlerManager.registerHandler(RPC_METHODS.SteerQueuedMessage, (payload: unknown) =>
            this.steerQueuedMessage(payload));

        while (!this.shouldExit) {
            await this.abortInFlight;
            if (this.needsBackendRestart) {
                await this.initializeBackend(true);
                this.needsBackendRestart = false;
            }
            const waitSignal = this.abortController.signal;
            const batch = await session.queue.waitForMessagesAndGetAsString(waitSignal);
            if (!batch) {
                if (waitSignal.aborted && !this.shouldExit) continue;
                break;
            }
            await this.abortInFlight;
            if (this.shouldExit) break;
            if (this.needsBackendRestart) {
                await this.initializeBackend(true);
                this.needsBackendRestart = false;
            }
            const backend = this.backend!;
            const acpSessionId = session.sessionId!;
            let finishTurn!: () => void;
            const turn: MinimaxTurn = {
                signal: this.abortController.signal,
                modeHash: batch.hash,
                acceptingSteers: true,
                completed: new Promise<void>((resolve) => { finishTurn = resolve; }),
                steers: new Set()
            };
            this.activeTurn = turn;
            session.onThinkingChange(true);
            try {
                if (batch.mode.model && batch.mode.model !== this.currentBackendModel) {
                    const switched = await this.applyModel(backend, acpSessionId, batch.mode.model);
                    if (switched) this.currentBackendModel = batch.mode.model;
                    else batch.mode.model = this.currentBackendModel ?? undefined;
                }
                if (batch.mode.permissionMode && batch.mode.permissionMode !== this.lastAppliedPermissionMode) {
                    await this.applyPermissionMode(backend, acpSessionId, batch.mode.permissionMode);
                }
                this.applyDisplayMode(batch.mode.permissionMode, batch.mode.model);
                turn.modeHash = session.queue.modeHasher(batch.mode);
                await backend.waitForResponseComplete();
                if (!turn.signal.aborted) {
                    messageBuffer.addMessage(batch.message, 'user');
                    await this.dispatchWithActiveTurnRetry(backend, acpSessionId, [{ type: 'text', text: batch.message }], turn);
                    if (!turn.signal.aborted) void backend.refreshSessionInfo(acpSessionId, session.path);
                }
            } catch (error) {
                if (!turn.signal.aborted) {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    logger.warn('[minimax-remote] prompt failed', { message: errorMessage });
                    session.sendSessionEvent({ type: 'message', message: `MiniMax prompt failed: ${errorMessage}` });
                    messageBuffer.addMessage(`MiniMax prompt failed: ${errorMessage}`, 'status');
                }
            } finally {
                turn.acceptingSteers = false;
                await Promise.allSettled([...turn.steers]);
                if (this.activeTurn === turn) this.activeTurn = null;
                finishTurn();
                // Stop may be reconnecting a stuck runtime. Do not dispatch the
                // next message or report ready while cancellation is unfinished.
                await this.abortInFlight;
                session.onThinkingChange(false);
                await this.permissionHandler?.cancelAll('Prompt finished');
                if (!this.needsBackendRestart) this.publishModelCatalog(backend, acpSessionId);
                if (session.queue.size() === 0 && !this.shouldExit) sendReady();
            }
        }
    }

    private async initializeBackend(strictResume = false): Promise<void> {
        const session = this.session;
        const messageBuffer = this.messageBuffer;
        const backend = createMinimaxBackend();
        this.backend = backend;
        registerAcpSessionTitleSync(backend, session.client);
        this.permissionHandler = new AcpPermissionHandler(
            session.client,
            backend,
            () => session.getPermissionMode() as PermissionMode | undefined,
            (message) => this.handleAgentMessage(message)
        );

        backend.onStderrError((error) => {
            logger.debug('[minimax-remote] stderr error', error);
            session.sendSessionEvent({ type: 'message', message: error.message });
            messageBuffer.addMessage(error.message, 'status');
        });

        await backend.initialize();

        const resumeSessionId = session.sessionId;
        const acpMcpServers = this.acpMcpServers;
        let acpSessionId: string;
        if (resumeSessionId) {
            try {
                acpSessionId = await backend.loadSession({
                    sessionId: resumeSessionId,
                    cwd: session.path,
                    mcpServers: acpMcpServers
                });
            } catch (error) {
                if (strictResume) throw error;
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
        if (strictResume && acpSessionId !== resumeSessionId) {
            throw new Error('MiniMax resumed a different session after Stop');
        }
        session.onSessionFound(acpSessionId);

        // Model selection goes over the ACP `model` config option. Adopt the
        // agent-reported current model unless the session pinned one; publish
        // the catalog for the web model picker either way.
        const modelOption = backend.getConfigOptionByCategory(acpSessionId, 'model');
        let effectiveModel: string | null = modelOption?.currentValue ?? null;
        const requestedModel = strictResume ? this.currentBackendModel ?? this.model : this.model;
        if (requestedModel && modelOption && modelOption.currentValue !== requestedModel) {
            const applied = await this.applyModel(backend, acpSessionId, requestedModel);
            if (applied) {
                effectiveModel = requestedModel;
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
    }

    protected async cleanup(): Promise<void> {
        this.clearAbortHandlers(this.session.client.rpcHandlerManager);
        this.session.client.rpcHandlerManager.registerHandler(RPC_METHODS.SteerQueuedMessage, async () => ({
            steered: false, error: 'No active remote MiniMax turn'
        }));

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

    private steerQueuedMessage(payload: unknown): Promise<{ steered: boolean; error?: string }> {
        const localId = typeof (payload as { localId?: unknown } | null)?.localId === 'string'
            ? (payload as { localId: string }).localId : '';
        const turn = this.activeTurn;
        if (!localId || !turn?.acceptingSteers || turn.signal.aborted || this.shouldExit) {
            return Promise.resolve({ steered: false, error: 'No active steerable turn or missing localId' });
        }
        const operation = this.deliverSteer(localId, turn);
        turn.steers.add(operation);
        void operation.then(() => turn.steers.delete(operation), () => turn.steers.delete(operation));
        return operation;
    }

    private async deliverSteer(localId: string, turn: MinimaxTurn): Promise<{ steered: boolean; error?: string }> {
        const backend = this.backend!;
        const queue = this.session.queue;
        const client = this.session.client;
        const reservation = queue.takeByLocalId(localId);
        if (!reservation) return { steered: false, error: 'Message not in queue or already dispatched' };
        if (reservation.item.isolate || reservation.item.modeHash !== turn.modeHash) {
            queue.restoreReservation(reservation);
            return { steered: false, error: 'Queued message mode differs from the active turn' };
        }
        if (!queue.beginReservationDispatch(reservation)) return { steered: false, error: 'Steer cancelled' };
        const hold = () => {
            if (queue.markReservationIndeterminate(reservation)) client.emitSteerIndeterminate([localId]);
            return { steered: false, error: 'Steer delivery could not be confirmed' };
        };
        const restore = async () => {
            if (!reservation.originIndeterminate && !await client.setSteerDeliveryState([localId], 'queued')) {
                hold();
                return;
            }
            queue.restoreReservation(reservation);
        };
        if (!await client.setSteerDeliveryState([localId], 'dispatching')) return hold();
        if (reservation.state !== 'dispatching' || this.activeTurn !== turn || !turn.acceptingSteers || turn.signal.aborted || this.backend !== backend) {
            await restore();
            return { steered: false, error: 'Active turn stopped or changed' };
        }
        try {
            // Native steer acknowledges admission, rather than waiting for the
            // whole model response. Never send a concurrent session/prompt.
            const response = await backend.sendExtensionRequest<{ mode?: string; turnId?: string }>(
                'mcode/session/steer',
                { sessionId: this.session.sessionId, text: reservation.item.message, clientRequestId: localId },
                { timeoutMs: 10_000 }
            );
            if (response?.mode !== 'steered' || typeof response.turnId !== 'string') return hold();
            if (queue.commitReservation(reservation)) {
                this.messageBuffer.addMessage(reservation.item.message, 'user');
                client.emitMessagesConsumed([localId], { steered: true });
            }
            return { steered: true };
        } catch (error) {
            logger.debug('[minimax-remote] native steer failed', error);
            if (isAcpIndeterminateError(error)) return hold();
            await restore();
            return { steered: false, error: error instanceof Error ? error.message : String(error) };
        }
    }

    private async dispatchWithActiveTurnRetry(
        backend: ReturnType<typeof createMinimaxBackend>,
        acpSessionId: string,
        promptContent: PromptContent[],
        turn: MinimaxTurn
    ): Promise<void> {
        const deadline = Date.now() + 10_000;
        let delayMs = 200;
        while (!turn.signal.aborted && !this.shouldExit) {
            try {
                await backend.prompt(acpSessionId, promptContent, (message: AgentMessage) => this.handleAgentMessage(message));
                return;
            } catch (error) {
                if (turn.signal.aborted || this.shouldExit) return;
                const message = error instanceof Error ? error.message : String(error);
                if (!message.includes('Session already has an active Turn') || Date.now() >= deadline) throw error;
                logger.debug('[minimax-remote] waiting for runtime turn retirement', { delayMs });
                await new Promise<void>((resolve) => {
                    const finish = () => {
                        clearTimeout(timer);
                        turn.signal.removeEventListener('abort', finish);
                        resolve();
                    };
                    const timer = setTimeout(finish, delayMs);
                    turn.signal.addEventListener('abort', finish, { once: true });
                });
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

    private handleAbort(): Promise<void> {
        if (this.abortInFlight) return this.abortInFlight;
        const turn = this.activeTurn;
        const backend = this.backend;
        this.abortController.abort();
        this.abortController = new AbortController();
        this.abortInFlight = this.stopTurn(backend, turn).finally(() => { this.abortInFlight = null; });
        return this.abortInFlight;
    }

    private async stopTurn(backend: ReturnType<typeof createMinimaxBackend> | null, turn: MinimaxTurn | null): Promise<void> {
        if (backend && this.session.sessionId && turn) await backend.cancelPrompt(this.session.sessionId);
        await this.permissionHandler?.cancelAll('User aborted');
        if (turn) {
            let timer: ReturnType<typeof setTimeout> | undefined;
            const stopped = await Promise.race([
                turn.completed.then(() => true),
                new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), 5000); })
            ]);
            clearTimeout(timer);
            if (!stopped && backend) {
                logger.warn('[minimax-remote] cancellation timed out, restarting ACP with the same session');
                await backend.disconnect();
                this.needsBackendRestart = true;
            }
        }
        this.session.sendSessionEvent({ type: 'message', message: 'Session aborted' });
        this.session.onThinkingChange(false);
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
