import { describe, expect, it } from 'vitest'
import type { Machine } from '@/types/api'
import { orderCreateSessionAgents, resolveDefaultMachineDirectory } from './defaults'

function machine(metadata: Machine['metadata']): Machine {
    return {
        id: 'machine-1',
        namespace: 'default',
        seq: 1,
        createdAt: 1,
        updatedAt: 1,
        active: true,
        activeAt: 1,
        metadata,
        metadataVersion: 1,
        runnerState: null,
        runnerStateVersion: 1
    }
}

describe('new session defaults', () => {
    it('orders Create Session agents as codex, GLM (claude), antigravity, opencode, cursor, minimax', () => {
        expect(orderCreateSessionAgents(['agy', 'claude', 'codex', 'cursor', 'minimax', 'opencode']))
            .toEqual(['codex', 'claude', 'agy', 'opencode', 'cursor', 'minimax'])
    })

    it('keeps unlisted agents in their incoming order before MiniMax at the end', () => {
        expect(orderCreateSessionAgents(['grok', 'agy', 'claude', 'codex', 'pi', 'cursor', 'minimax', 'opencode']))
            .toEqual(['codex', 'claude', 'agy', 'opencode', 'cursor', 'grok', 'pi', 'minimax'])
    })

    it('prefers the runner workspace root over recent paths and home', () => {
        expect(resolveDefaultMachineDirectory(machine({
            host: 'host',
            platform: 'linux',
            happyCliVersion: '1.0.0',
            workspaceRoots: ['/workspace/code'],
            homeDir: '/home/user'
        }), ['/workspace/recent'])).toBe('/workspace/code')
    })

    it('falls back to a recent path and then the machine home', () => {
        const recentMachine = machine({
            host: 'host',
            platform: 'linux',
            happyCliVersion: '1.0.0',
            homeDir: '/home/user'
        })
        expect(resolveDefaultMachineDirectory(recentMachine, ['/workspace/recent']))
            .toBe('/workspace/recent')
        expect(resolveDefaultMachineDirectory(recentMachine, [])).toBe('/home/user')
    })
})
