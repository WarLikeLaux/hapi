import type { PermissionMode } from '../types';

/**
 * Mapping between HAPI permission modes and MiniMax Code's two native ACP
 * surfaces: session modes (`default` / `plan` via `session/set_mode`) and the
 * process-scoped `permissionMode` config option (`default` (Ask) / `auto` /
 * `bypassPermissions` (Full access) via `session/set_config_option`).
 */
export type MinimaxModeApplication = {
    acpSessionModeId: 'default' | 'plan';
    permissionConfigValue?: 'default' | 'auto' | 'bypassPermissions';
};

export function mapMinimaxPermissionMode(mode: PermissionMode | undefined): MinimaxModeApplication {
    if (mode === 'plan') {
        return { acpSessionModeId: 'plan' };
    }
    if (mode === 'auto') {
        return { acpSessionModeId: 'default', permissionConfigValue: 'auto' };
    }
    if (mode === 'yolo') {
        return { acpSessionModeId: 'default', permissionConfigValue: 'bypassPermissions' };
    }
    return { acpSessionModeId: 'default', permissionConfigValue: 'default' };
}
