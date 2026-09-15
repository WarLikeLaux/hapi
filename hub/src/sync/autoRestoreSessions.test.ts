import { describe, expect, it } from 'bun:test'
import { Store } from '../store'
import { RpcRegistry } from '../socket/rpcRegistry'
import { SyncEngine } from './syncEngine'

const NAMESPACE = 'default'

function createEngine(): SyncEngine {
    return new SyncEngine(
        new Store(':memory:'),
        {} as never,
        new RpcRegistry(),
        { broadcast() {} } as never,
        { autoRestoreSessions: true, autoRestoreDelayMs: 0 },
    )
}

function addMachine(engine: SyncEngine): void {
    engine.getOrCreateMachine(
        'machine-1',
        { host: 'localhost', platform: 'linux', happyCliVersion: '0.1.0' },
        { status: 'running', pid: 123, startedAt: 1_000 },
        NAMESPACE,
    )
}

function addInactiveSession(
    engine: SyncEngine,
    tag: string,
    metadata: Record<string, unknown>,
): string {
    const session = engine.getOrCreateSession(
        tag,
        {
            path: '/tmp/project',
            host: 'localhost',
            machineId: 'machine-1',
            flavor: 'codex',
            codexSessionId: `${tag}-thread`,
            ...metadata,
        },
        { requests: {}, completedRequests: {} },
        NAMESPACE,
    )
    engine.handleSessionEnd({ sid: session.id, time: Date.now() })
    return session.id
}

async function waitForCalls(calls: string[], expected: number): Promise<void> {
    const deadline = Date.now() + 500
    while (calls.length < expected && Date.now() < deadline) {
        await Bun.sleep(5)
    }
}

describe('cold session auto-restore', () => {
    it('restores only inactive runner sessions that were left running', async () => {
        const engine = createEngine()
        try {
            addMachine(engine)
            const resumableId = addInactiveSession(engine, 'resumable', {
                lifecycleState: 'running',
                startedBy: 'runner',
                startedFromRunner: true,
            })
            const gracefulShutdownId = addInactiveSession(engine, 'graceful-shutdown', {
                lifecycleState: 'archived',
                lifecycleStateSince: 900,
                archivedBy: 'cli',
                archiveReason: 'Hub restart',
                startedBy: 'runner',
                startedFromRunner: true,
            })
            addInactiveSession(engine, 'manually-archived', {
                lifecycleState: 'archived',
                lifecycleStateSince: 900,
                archivedBy: 'cli',
                archiveReason: 'User terminated',
                startedBy: 'runner',
                startedFromRunner: true,
            })
            addInactiveSession(engine, 'terminal-started', {
                lifecycleState: 'running',
                startedBy: 'terminal',
            })
            const activeSession = engine.getOrCreateSession(
                'still-active',
                {
                    path: '/tmp/project',
                    host: 'localhost',
                    machineId: 'machine-1',
                    flavor: 'codex',
                    codexSessionId: 'active-thread',
                    lifecycleState: 'running',
                    startedBy: 'runner',
                },
                null,
                NAMESPACE,
            )
            engine.handleSessionAlive({ sid: activeSession.id, time: Date.now() })

            const calls: string[] = []
            const reopenCalls: string[] = []
            const options: unknown[] = []
            ;(engine as unknown as { resumeSession: (...args: unknown[]) => Promise<unknown> }).resumeSession = async (
                sessionId: unknown,
                _namespace: unknown,
                opts: unknown,
            ) => {
                calls.push(String(sessionId))
                options.push(opts)
                return { type: 'success', sessionId }
            }
            ;(engine as unknown as { reopenSession: (...args: unknown[]) => Promise<unknown> }).reopenSession = async (
                sessionId: unknown,
            ) => {
                calls.push(String(sessionId))
                reopenCalls.push(String(sessionId))
                return { type: 'success', sessionId, resumed: true }
            }

            engine.handleMachineAlive({ machineId: 'machine-1', time: Date.now() })
            await waitForCalls(calls, 2)
            await Bun.sleep(20)

            expect(new Set(calls)).toEqual(new Set([resumableId, gracefulShutdownId]))
            expect(reopenCalls).toEqual([gracefulShutdownId])
            expect(options).toEqual([{ freshGeneration: true }])

            engine.handleMachineAlive({ machineId: 'machine-1', time: Date.now() })
            await Bun.sleep(20)
            expect(calls).toHaveLength(2)
        } finally {
            engine.stop()
        }
    })

    it('continues restoring other sessions when one restore fails', async () => {
        const engine = createEngine()
        try {
            addMachine(engine)
            addInactiveSession(engine, 'first', {
                lifecycleState: 'running',
                startedBy: 'runner',
            })
            addInactiveSession(engine, 'second', {
                lifecycleState: 'running',
                startedBy: 'runner',
            })

            const calls: string[] = []
            ;(engine as unknown as { resumeSession: (...args: unknown[]) => Promise<unknown> }).resumeSession = async (
                sessionId: unknown,
            ) => {
                calls.push(String(sessionId))
                if (calls.length === 1) throw new Error('simulated failure')
                return { type: 'success', sessionId }
            }

            engine.handleMachineAlive({ machineId: 'machine-1', time: Date.now() })
            await waitForCalls(calls, 2)

            expect(calls).toHaveLength(2)
        } finally {
            engine.stop()
        }
    })
})
