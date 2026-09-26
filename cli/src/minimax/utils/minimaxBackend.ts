import { AcpSdkBackend } from '@/agent/backends/acp';
import { getAgentLaunchCommand } from '@/agent/agentLaunchCommand';

function filterEnv(env: NodeJS.ProcessEnv): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(env)) {
        if (value !== undefined) {
            result[key] = value;
        }
    }
    return result;
}

/**
 * Creates the ACP backend for `mcode acp`. Permission and model choices go
 * over ACP config options (`permissionMode` / `model`), never environment —
 * the CLI reads its own auth and policy config.
 */
export function createMinimaxBackend(): AcpSdkBackend {
    return new AcpSdkBackend({
        command: getAgentLaunchCommand('minimax'),
        args: ['acp'],
        env: filterEnv(process.env),
        flavor: 'minimax',
    });
}
