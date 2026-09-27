import { logger } from '@/ui/logger';
import { minimaxLocal } from './minimaxLocal';
import { MinimaxSession } from './session';
import { BaseLocalLauncher } from '@/modules/common/launcher/BaseLocalLauncher';
import { createMinimaxSessionLocator, type MinimaxSessionLocator } from './utils/sessionLocator';

export async function minimaxLocalLauncher(
    session: MinimaxSession,
    opts: {
        model?: string;
    }
): Promise<'switch' | 'exit'> {
    // Local mode spawns the native mcode TUI. Only the native session id is
    // discovered (for handoff and later ACP resume); conversation mirroring
    // is not implemented yet.
    //
    // The HAPI MCP bridge (and therefore the change_title tool) is intentionally
    // not exposed in local mode: mcode is spawned as a plain terminal process
    // with no HAPI-controlled MCP config, so injecting the per-turn title-check
    // block from ApiSession would only prompt the model to call a tool that
    // cannot exist. Leave the flag at its default (false) and rely on manual
    // rename or the agent's own native title sync for renaming.
    session.client.setHapiTitleToolAvailable(false);
    const locator: MinimaxSessionLocator = createMinimaxSessionLocator({
        startupTimestampMs: Date.now(),
        resumeSessionId: session.sessionId,
        onLocated: (sessionId) => {
            session.onSessionFound(sessionId);
        },
        onAmbiguous: (sessionIds) => {
            logger.warn(`[minimax-local]: Ambiguous fresh mcode sessions (${sessionIds.join(', ')}); session sync disabled for this launch`);
        }
    });

    const launcher = new BaseLocalLauncher({
        label: 'minimax-local',
        failureLabel: 'Local MiniMax Code process failed',
        queue: session.queue,
        rpcHandlerManager: session.client.rpcHandlerManager,
        startedBy: session.startedBy,
        startingMode: session.startingMode,
        launch: async (abortSignal) => {
            await minimaxLocal({
                path: session.path,
                sessionId: session.sessionId,
                abort: abortSignal,
                model: opts.model
            });
        },
        sendFailureMessage: (message) => {
            session.sendSessionEvent({ type: 'message', message });
        },
        recordLocalLaunchFailure: (message, exitReason) => {
            session.recordLocalLaunchFailure(message, exitReason);
        }
    });

    try {
        // Ensure the pre-existing-session snapshot completed before mcode
        // spawns; otherwise the session dir created by this launch could be
        // captured in the snapshot and permanently excluded from discovery.
        await locator.ready;
        return await launcher.run();
    } finally {
        await locator.cleanup();
    }
}
