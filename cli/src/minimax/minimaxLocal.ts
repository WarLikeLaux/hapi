import { logger } from '@/ui/logger';
import { spawnWithTerminalGuard } from '@/utils/spawnWithTerminalGuard';
import { getAgentLaunchCommand } from '@/agent/agentLaunchCommand';

export async function minimaxLocal(opts: {
    path: string;
    sessionId: string | null;
    abort: AbortSignal;
    model?: string;
}): Promise<void> {
    const args: string[] = [];

    if (opts.sessionId) {
        args.push('--session', opts.sessionId);
    }
    if (opts.model) {
        args.push('--model', opts.model);
    }

    const env: NodeJS.ProcessEnv = {
        ...process.env
    };

    logger.debug(`[MinimaxLocal] Spawning mcode with args: ${JSON.stringify(args)}`);

    await spawnWithTerminalGuard({
        command: getAgentLaunchCommand('minimax'),
        args,
        cwd: opts.path,
        env,
        signal: opts.abort,
        shell: process.platform === 'win32',
        logLabel: 'MinimaxLocal',
        spawnName: 'mcode',
        installHint: 'MiniMax Code CLI (@minimax-ai/code)',
        includeCause: true,
        logExit: true
    });
}
