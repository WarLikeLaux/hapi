import { describe, expect, it } from 'vitest';
import { resolveCodexPermissionModeConfig } from './permissionModeConfig';

describe('resolveCodexPermissionModeConfig', () => {
    it('uses on-request approvals for default mode', () => {
        expect(resolveCodexPermissionModeConfig('default')).toEqual({
            approvalPolicy: 'on-request',
            sandbox: 'workspace-write',
            sandboxPolicy: { type: 'workspaceWrite' }
        });
    });

    it('keeps safe-yolo escalation available with a supported approval policy', () => {
        expect(resolveCodexPermissionModeConfig('safe-yolo')).toEqual({
            approvalPolicy: 'on-request',
            sandbox: 'workspace-write',
            sandboxPolicy: { type: 'workspaceWrite' }
        });
    });

    it('allows only rule and MCP prompts in yolo mode', () => {
        expect(resolveCodexPermissionModeConfig('yolo')).toEqual({
            approvalPolicy: {
                granular: {
                    sandbox_approval: false,
                    rules: true,
                    skill_approval: false,
                    request_permissions: false,
                    mcp_elicitations: true
                }
            },
            sandbox: 'danger-full-access',
            sandboxPolicy: { type: 'dangerFullAccess' }
        });
    });
});
