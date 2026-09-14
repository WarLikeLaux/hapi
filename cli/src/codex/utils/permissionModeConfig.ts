import type { CodexPermissionMode } from '@hapi/protocol/types';
import type { ApprovalPolicy, SandboxMode, SandboxPolicy } from '../appServerTypes';

export const CODEX_YOLO_APPROVAL_POLICY = {
    granular: {
        sandbox_approval: false,
        rules: true,
        skill_approval: false,
        request_permissions: false,
        mcp_elicitations: true
    }
} as const satisfies ApprovalPolicy;

export function serializeCodexApprovalPolicy(policy: ApprovalPolicy): string {
    if (typeof policy === 'string') {
        return JSON.stringify(policy);
    }

    const granular = Object.entries(policy.granular)
        .map(([key, value]) => `${key} = ${value}`)
        .join(', ');
    return `{ granular = { ${granular} } }`;
}

export type CodexPermissionModeConfig = {
    approvalPolicy: ApprovalPolicy;
    sandbox: SandboxMode;
    sandboxPolicy: SandboxPolicy;
};

export function resolveCodexPermissionModeConfig(mode: CodexPermissionMode): CodexPermissionModeConfig {
    switch (mode) {
        case 'default':
            return {
                // Remote Codex sessions rely on HAPI's approval UI for sandbox escalation.
                // `on-request` keeps workspace-write sandboxing while still surfacing a
                // user-approvable elevation request when the model needs it.
                approvalPolicy: 'on-request',
                sandbox: 'workspace-write',
                sandboxPolicy: { type: 'workspaceWrite' }
            };
        case 'read-only':
            return {
                approvalPolicy: 'never',
                sandbox: 'read-only',
                sandboxPolicy: { type: 'readOnly' }
            };
        case 'safe-yolo':
            return {
                // Current Codex versions reject the removed `on-failure` policy. Keep
                // escalation available through `on-request`; HAPI auto-approves these
                // requests in safe-yolo mode.
                approvalPolicy: 'on-request',
                sandbox: 'workspace-write',
                sandboxPolicy: { type: 'workspaceWrite' }
            };
        case 'yolo':
            return {
                // Keep unrestricted execution, but respect explicit execpolicy
                // prompt rules such as a project's git commit/push guard.
                approvalPolicy: CODEX_YOLO_APPROVAL_POLICY,
                sandbox: 'danger-full-access',
                sandboxPolicy: { type: 'dangerFullAccess' }
            };
    }

    const unexpectedMode: never = mode;
    throw new Error(`Unknown permission mode: ${unexpectedMode}`);
}

export function buildCodexPermissionModeCliArgs(mode: Exclude<CodexPermissionMode, 'default'>): string[] {
    const config = resolveCodexPermissionModeConfig(mode);
    const approvalArgs = typeof config.approvalPolicy === 'string'
        ? ['--ask-for-approval', config.approvalPolicy]
        : ['-c', `approval_policy=${serializeCodexApprovalPolicy(config.approvalPolicy)}`];
    return [...approvalArgs, '--sandbox', config.sandbox];
}
