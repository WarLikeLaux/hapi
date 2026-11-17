import { describe, expect, it } from 'bun:test'
import { MACHINE_CAPABILITIES, RPC_METHODS } from '@hapi/protocol'
import type { SessionProcessIdentity } from '@hapi/protocol/schemas'
import { RpcRegistry } from '../socket/rpcRegistry'
import { Store } from '../store'
import { SyncEngine } from './syncEngine'

describe('upgrading session processes', () => {
    it('waits for a stale chat to finish and resumes its existing conversation with its saved settings', async () => {
        const store = new Store(':memory:')
        const registry = new RpcRegistry()
        const rpcCalls: Array<{ method: string; params: unknown }> = []
        const stalePid = 100
        const currentPid = 200
        const machineId = 'machine'
        const namespace = 'default'
        const sockets = new Map<string, unknown>()
        const engine = new SyncEngine(
            store, { of: () => ({ sockets, to: () => ({ emit() {} }) }) } as never, registry, { broadcast() {} } as never,
            { autoRestoreSessions: true, autoRestoreDelayMs: 0 }
        )
        const addSession = (tag: string, pid: number, thinking: boolean) => {
            const session = engine.getOrCreateSession(tag, {
                path: '/tmp/project',
                host: 'localhost',
                hostPid: pid,
                hostStartMarker: String(pid),
                machineId,
                flavor: 'codex',
                codexSessionId: `${tag}-thread`,
                startedBy: 'runner',
                lifecycleState: 'running',
            }, { startingMode: 'remote' }, namespace, 'gpt-6.2-sol', undefined, 'medium')
            engine.handleSessionAlive({ sid: session.id, time: Date.now(), thinking, serviceTier: 'fast' })
            return session
        }

        try {
            engine.getOrCreateMachine(machineId, {
                host: 'localhost',
                platform: 'linux',
                happyCliVersion: '1',
                capabilities: [MACHINE_CAPABILITIES.FindStaleSessionProcesses],
            }, { status: 'running', pid: 1, startedAt: 1 }, namespace)
            const stale = addSession('stale', stalePid, true)
            const current = addSession('current', currentPid, false)
            let resolveResume!: () => void
            const resumed = new Promise<void>(resolve => { resolveResume = resolve })
            const socket = {
                id: 'test-socket',
                timeout() { return this },
                async emitWithAck(_: string, request: { method: string; params: string }) {
                    const params = JSON.parse(request.params)
                    rpcCalls.push({ method: request.method, params })
                    if (request.method === `${machineId}:${RPC_METHODS.FindStaleSessionProcesses}`) {
                        return (params as SessionProcessIdentity[]).map(process => process.pid).filter(pid => pid === stalePid)
                    }
                    if (request.method.endsWith(':' + RPC_METHODS.KillSession)) return { success: true }
                    if (request.method.endsWith(':' + RPC_METHODS.StopSession)) return { success: true, status: 'stopped' }
                    if (request.method.endsWith(':' + RPC_METHODS.SpawnHappySession)) {
                        engine.handleSessionAlive({ sid: params.existingSessionId, time: Date.now(), thinking: false })
                        engine.handleSessionReady({ sid: params.existingSessionId, time: Date.now() })
                        resolveResume()
                        return { type: 'success', sessionId: params.existingSessionId }
                    }
                    throw new Error(`Unexpected RPC: ${request.method}`)
                },
            }
            sockets.set(socket.id, socket)
            for (const method of [
                `${machineId}:${RPC_METHODS.FindStaleSessionProcesses}`,
                `${machineId}:${RPC_METHODS.StopSession}`,
                `${machineId}:${RPC_METHODS.SpawnHappySession}`,
                `${stale.id}:${RPC_METHODS.KillSession}`,
                `${current.id}:${RPC_METHODS.KillSession}`,
            ]) registry.register(socket as never, method)

            engine.handleMachineAlive({ machineId, time: Date.now() })
            await Bun.sleep(0)
            expect(rpcCalls.some(call => call.method.endsWith(':' + RPC_METHODS.KillSession))).toBe(false)
            expect(engine.getSession(stale.id)?.thinking).toBe(true)

            engine.handleSessionIdle(stale.id, Date.now())
            engine.handleMachineAlive({ machineId, time: Date.now() })
            await Promise.race([resumed, Bun.sleep(1_000).then(() => { throw new Error('Expected session to resume') })])
            expect(rpcCalls.filter(call => call.method.endsWith(':' + RPC_METHODS.KillSession))).toEqual([
                { method: `${stale.id}:${RPC_METHODS.KillSession}`, params: {} },
            ])
            expect(rpcCalls.at(-1)).toMatchObject({
                method: `${machineId}:${RPC_METHODS.SpawnHappySession}`,
                params: {
                    existingSessionId: stale.id,
                    resumeSessionId: 'stale-thread',
                    serviceTier: 'fast',
                    model: 'gpt-6.2-sol',
                    modelReasoningEffort: 'medium',
                    freshGeneration: true,
                },
            })
            expect(engine.getSession(stale.id)?.active).toBe(true)
            expect(engine.getSession(current.id)?.active).toBe(true)
        } finally {
            engine.stop()
        }
    })
})
