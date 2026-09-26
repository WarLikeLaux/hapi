import { describe, expect, it } from 'vitest';
import { mapMinimaxPermissionMode } from './permissionMode';

describe('mapMinimaxPermissionMode', () => {
    it('maps default to the ask policy', () => {
        expect(mapMinimaxPermissionMode('default')).toEqual({
            acpSessionModeId: 'default',
            permissionConfigValue: 'default'
        });
    });

    it('maps auto to the agent smart policy', () => {
        expect(mapMinimaxPermissionMode('auto')).toEqual({
            acpSessionModeId: 'default',
            permissionConfigValue: 'auto'
        });
    });

    it('maps yolo to full access', () => {
        expect(mapMinimaxPermissionMode('yolo')).toEqual({
            acpSessionModeId: 'default',
            permissionConfigValue: 'bypassPermissions'
        });
    });

    it('maps plan to the plan session mode without touching the permission policy', () => {
        expect(mapMinimaxPermissionMode('plan')).toEqual({ acpSessionModeId: 'plan' });
    });

    it('falls back to default ask for undefined', () => {
        expect(mapMinimaxPermissionMode(undefined)).toEqual({
            acpSessionModeId: 'default',
            permissionConfigValue: 'default'
        });
    });
});
