import { describe, expect, it } from 'bun:test'
import {
    PeerSpawnDefaultsSchema,
    mergePeerSpawnDefaults,
    resolvePeerSpawnConfig,
    resolvePermissionModeForFlavor
} from './peerSpawnDefaults'

describe('resolvePermissionModeForFlavor', () => {
    it('maps explicit yolo to bypassPermissions for claude', () => {
        expect(resolvePermissionModeForFlavor('yolo', 'claude')).toBe('bypassPermissions')
    })

    it('keeps yolo for codex', () => {
        expect(resolvePermissionModeForFlavor('yolo', 'codex')).toBe('yolo')
    })

    it('keeps explicit bypassPermissions for claude', () => {
        expect(resolvePermissionModeForFlavor('bypassPermissions', 'claude')).toBe('bypassPermissions')
    })

    it('remaps resolved Claude bypassPermissions to codex yolo', () => {
        expect(resolvePermissionModeForFlavor('bypassPermissions', 'codex')).toBe('yolo')
    })

    it('remaps resolved Claude bypassPermissions to cursor yolo', () => {
        expect(resolvePermissionModeForFlavor('bypassPermissions', 'cursor')).toBe('yolo')
    })

    it('remaps Kimi safe-yolo onto Codex yolo (launchable auto-approval)', () => {
        expect(resolvePermissionModeForFlavor('safe-yolo', 'codex')).toBe('yolo')
    })

    it('falls back to AGY request-review instead of Claude default', () => {
        expect(resolvePermissionModeForFlavor('default', 'agy')).toBe('request-review')
    })
})

describe('mergePeerSpawnDefaults', () => {
    it.each([null, undefined])('uses default permissions and no model overrides when settings are %s', (settings) => {
        expect(mergePeerSpawnDefaults(settings)).toEqual({
            agent: 'claude',
            permissionMode: 'default',
            models: {}
        })
    })

    it('merges partial hub overrides', () => {
        expect(mergePeerSpawnDefaults({
            agent: 'cursor',
            models: { cursor: 'auto' }
        })).toEqual({
            agent: 'cursor',
            permissionMode: 'default',
            models: { cursor: 'auto' }
        })
    })
})

describe('resolvePeerSpawnConfig', () => {
    it('prefers explicit args over hub settings over stock', () => {
        expect(resolvePeerSpawnConfig(
            { agent: 'codex', permissionMode: 'read-only', model: 'gpt-5' },
            { agent: 'cursor', permissionMode: 'auto', models: { cursor: 'composer-2.5' } }
        )).toEqual({
            agent: 'codex',
            permissionMode: 'read-only',
            model: 'gpt-5'
        })
    })

    it('falls back to hub model for resolved agent', () => {
        expect(resolvePeerSpawnConfig(
            { agent: 'claude' },
            { models: { claude: 'opus' } }
        )).toEqual({
            agent: 'claude',
            permissionMode: 'default',
            model: 'opus'
        })
    })

    it('uses stock defaults when hub settings are unavailable', () => {
        expect(resolvePeerSpawnConfig({})).toEqual({
            agent: 'claude',
            permissionMode: 'default'
        })
    })

    it('re-maps a configured permission mode when agent override differs from hub default agent', () => {
        expect(resolvePeerSpawnConfig(
            { agent: 'cursor' },
            { agent: 'claude', permissionMode: 'yolo' }
        )).toEqual({
            agent: 'cursor',
            permissionMode: 'yolo'
        })
    })

    it('uses default permissions when no launch policy is configured and the agent is overridden', () => {
        expect(resolvePeerSpawnConfig(
            { agent: 'codex' },
            mergePeerSpawnDefaults(null)
        )).toEqual({
            agent: 'codex',
            permissionMode: 'default'
        })
    })

    it('forwards explicit effort', () => {
        expect(resolvePeerSpawnConfig({ effort: 'high' })).toEqual({
            agent: 'claude',
            permissionMode: 'default',
            effort: 'high'
        })
    })
})

describe('PeerSpawnDefaultsSchema', () => {
    it('rejects retired gemini as a spawn default agent', () => {
        expect(PeerSpawnDefaultsSchema.safeParse({ agent: 'gemini' }).success).toBe(false)
    })

    it('accepts creatable agents', () => {
        expect(PeerSpawnDefaultsSchema.safeParse({ agent: 'codex' }).success).toBe(true)
    })
})
