import { logger } from '@/ui/logger';
import { minimaxLoop } from './loop';
import { MessageQueue2 } from '@/utils/MessageQueue2';
import { hashObject } from '@/utils/deterministicJson';
import { registerKillSessionHandler } from '@/claude/registerKillSessionHandler';
import type { AgentState } from '@/api/types';
import type { MinimaxSession } from './session';
import type { MinimaxMode, PermissionMode } from './types';
import { bootstrapExistingSession, bootstrapSession } from '@/agent/sessionFactory';
import { registerLocalHandoffHandler } from '@/agent/localHandoff';
import { createModeChangeHandler, createRunnerLifecycle, setControlledByUser } from '@/agent/runnerLifecycle';
import { isPermissionModeAllowedForFlavor } from '@hapi/protocol';
import { PermissionModeSchema } from '@hapi/protocol/schemas';
import { formatMessageWithAttachments } from '@/utils/attachmentFormatter';
import { getInvokedCwd } from '@/utils/invokedCwd';
import { publishLiveMinimaxCatalog, registerMinimaxSessionModelHandlers } from './utils/models';

export async function runMinimax(opts: {
    startedBy?: 'runner' | 'terminal';
    startingMode?: 'local' | 'remote';
    permissionMode?: PermissionMode;
    model?: string;
    resumeSessionId?: string;
    existingSessionId?: string;
    /** Fresh-spawn reserved hub id from `--hapi-session-id` (create/getOrCreate). */
    reservedSessionId?: string;
    workingDirectory?: string;
} = {}): Promise<void> {
    const workingDirectory = opts.workingDirectory ?? getInvokedCwd();
    const startedBy = opts.startedBy ?? 'terminal';

    logger.debug(`[minimax] Starting with options: startedBy=${startedBy}, startingMode=${opts.startingMode}`);

    if (startedBy === 'runner' && opts.startingMode === 'local') {
        logger.debug('[minimax] Runner spawn requested with local mode; forcing remote mode');
        opts.startingMode = 'remote';
    }

    const initialState: AgentState = {
        controlledByUser: false
    };

    const bootstrap = opts.existingSessionId
        ? await bootstrapExistingSession({
            sessionId: opts.existingSessionId,
            flavor: 'minimax',
            startedBy,
            workingDirectory
        })
        : await bootstrapSession({
            flavor: 'minimax',
            startedBy,
            workingDirectory,
            agentState: initialState,
            model: opts.model,
            reservedSessionId: opts.reservedSessionId
        });
    const { api, session } = bootstrap;

    const startingMode: 'local' | 'remote' = opts.startingMode
        ?? (startedBy === 'runner' ? 'remote' : 'local');

    setControlledByUser(session, startingMode);

    const messageQueue = new MessageQueue2<MinimaxMode>((mode) => hashObject({
        permissionMode: mode.permissionMode,
        model: mode.model
    }));

    const sessionWrapperRef: { current: MinimaxSession | null } = { current: null };
    let currentPermissionMode: PermissionMode = opts.permissionMode ?? 'default';
    let sessionModel: string | null = opts.model ?? null;

    const lifecycle = createRunnerLifecycle({
        session,
        logTag: 'minimax',
        stopKeepAlive: () => sessionWrapperRef.current?.stopKeepAlive()
    });

    lifecycle.registerProcessHandlers();
    registerKillSessionHandler(session.rpcHandlerManager, lifecycle, session);
    registerLocalHandoffHandler(session.rpcHandlerManager, lifecycle);
    // The session model picker is served from the live ACP catalog published
    // by the remote launcher; registered here so it answers in local mode too.
    registerMinimaxSessionModelHandlers(session.rpcHandlerManager);

    const syncSessionMode = () => {
        const sessionInstance = sessionWrapperRef.current;
        if (!sessionInstance) {
            return;
        }
        sessionInstance.setPermissionMode(currentPermissionMode);
        sessionInstance.setModel(sessionModel);
        sessionInstance.pushKeepAlive();

        logger.debug(`[minimax] Synced session config for keepalive: permissionMode=${currentPermissionMode}, model=${sessionModel ?? 'agent-default'}`);
    };

    session.onUserMessage((message, localId) => {
        const formattedText = formatMessageWithAttachments(message.content.text, message.content.attachments);
        const mode: MinimaxMode = {
            permissionMode: currentPermissionMode,
            model: sessionModel ?? undefined
        };
        messageQueue.push(formattedText, mode, localId);
    });

    session.onCancelQueuedMessage((localId) => {
        const removed = messageQueue.cancelByLocalId(localId);
        logger.debug(`[minimax] cancelByLocalId(${localId}): ${removed ? 'removed' : 'not found (best-effort)'}`);
        return removed;
    });

    const resolvePermissionMode = (value: unknown): PermissionMode => {
        const parsed = PermissionModeSchema.safeParse(value);
        if (!parsed.success || !isPermissionModeAllowedForFlavor(parsed.data, 'minimax')) {
            throw new Error('Invalid permission mode');
        }
        return parsed.data as PermissionMode;
    };

    const resolveModel = (value: unknown): string | null => {
        if (value === null) {
            return null;
        }
        if (typeof value !== 'string' || value.trim().length === 0) {
            throw new Error('Invalid model');
        }
        return value.trim();
    };

    session.rpcHandlerManager.registerHandler('set-session-config', async (payload: unknown) => {
        if (!payload || typeof payload !== 'object') {
            throw new Error('Invalid session config payload');
        }
        const config = payload as { permissionMode?: unknown; model?: unknown };
        const applied: Record<string, unknown> = {};

        if (config.permissionMode !== undefined) {
            currentPermissionMode = resolvePermissionMode(config.permissionMode);
            applied.permissionMode = currentPermissionMode;
        }

        if (config.model !== undefined) {
            sessionModel = resolveModel(config.model);
            applied.model = sessionModel;
        }

        syncSessionMode();
        return { applied };
    });

    let crashed = false;

    try {
        await minimaxLoop({
            path: workingDirectory,
            startingMode,
            startedBy,
            messageQueue,
            session,
            api,
            permissionMode: currentPermissionMode,
            model: sessionModel ?? undefined,
            resumeSessionId: opts.resumeSessionId,
            onModeChange: createModeChangeHandler(session),
            onSessionReady: (instance) => {
                sessionWrapperRef.current = instance;
                syncSessionMode();
            }
        });
    } catch (error) {
        crashed = true;
        lifecycle.markCrash(error);
        logger.debug('[minimax] Loop error:', error);
    } finally {
        const localFailure = sessionWrapperRef.current?.localLaunchFailure;
        if (localFailure?.exitReason === 'exit') {
            lifecycle.setExitCode(1);
            lifecycle.setArchiveReason(`Local launch failed: ${localFailure.message.slice(0, 200)}`);
            lifecycle.setSessionEndReason('error');
        } else if (!crashed) {
            lifecycle.setSessionEndReason('completed');
        }
        publishLiveMinimaxCatalog(null);
        await lifecycle.cleanupAndExit();
    }
}
