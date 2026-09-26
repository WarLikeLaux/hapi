import type { MinimaxPermissionMode } from '@hapi/protocol/types';

export type PermissionMode = MinimaxPermissionMode;

export interface MinimaxMode {
    permissionMode: PermissionMode;
    model?: string;
}
