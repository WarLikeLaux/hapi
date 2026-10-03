import { describe, expect, it } from 'bun:test'
import { Store } from '../store'
import { RpcRegistry } from '../socket/rpcRegistry'
import { SyncEngine } from './syncEngine'

function createEngine() {
    const store = new Store(':memory:')
    const io = {
        of: () => ({
            to: () => ({ emit: () => {} })
        })
    }
    const engine = new SyncEngine(store, io as never, new RpcRegistry(), { broadcast() {} } as never)
    return { store, engine }
}

describe('SyncEngine.steerQueuedMessage', () => {
    it('rejects scheduled interrupts and reconciles a stale consumed Antigravity row without interrupting', async () => {
        const { store, engine } = createEngine()
        try {
            const session = engine.getOrCreateSession('interrupt-agy',
                { path: '/tmp/project', host: 'localhost', flavor: 'agy' },
                { requests: {}, completedRequests: {} }, 'default')
            const scheduled = store.messages.addMessage(session.id, { text: 'scheduled' }, 'scheduled-id', Date.now() - 1000)
            expect(await engine.interruptQueuedMessage(session.id, scheduled.id)).toEqual({
                status: 'failed', error: 'Only immediate queued messages can interrupt a turn', localId: 'scheduled-id',
            })
            const consumed = store.messages.addMessage(session.id, { text: 'consumed' }, 'consumed-id')
            store.messages.markMessagesInvoked(session.id, ['consumed-id'], 5000)
            const result = await engine.interruptQueuedMessage(session.id, consumed.id)
            expect(result.status).toBe('invoked')
            if (result.status === 'invoked') expect(result.message.invokedAt).toBe(5000)
            expect(store.messages.lookupQueuedMessage(session.id, scheduled.id).status).toBe('queued')
        } finally {
            engine.stop()
        }
    })

    it('rejects every scheduled row, mature ones included, without invoking the CLI', async () => {
        const { store, engine } = createEngine()
        try {
            const session = engine.getOrCreateSession(
                'steer-scheduled',
                { path: '/tmp/project', host: 'localhost', flavor: 'pi' },
                { requests: {}, completedRequests: {} },
                'default'
            )
            // A mature scheduled row: the fire time already passed, but the row
            // is still uninvoked and waiting for the scheduled-FIFO release.
            const message = store.messages.addMessage(
                session.id,
                { text: 'mature scheduled' },
                'mature-local',
                Date.now() - 1_000
            )

            const result = await engine.steerQueuedMessage(session.id, message.id)

            expect(result).toEqual({
                status: 'failed',
                error: 'Scheduled messages cannot be steered',
                localId: 'mature-local'
            })
            // The row must stay queued — untouched by the rejected steer.
            const lookup = store.messages.lookupQueuedMessage(session.id, message.id)
            expect(lookup.status).toBe('queued')
        } finally {
            engine.stop()
        }
    })

    it('rejects unsupported flavors without invoking the CLI', async () => {
        const { store, engine } = createEngine()
        try {
            const session = engine.getOrCreateSession(
                'steer-agy',
                { path: '/tmp/project', host: 'localhost', flavor: 'agy' },
                { requests: {}, completedRequests: {} },
                'default'
            )
            const message = store.messages.addMessage(session.id, { text: 'hi' }, 'local-id')

            const result = await engine.steerQueuedMessage(session.id, message.id)

            expect(result).toEqual({
                status: 'failed',
                error: 'Steering is not supported for this session',
                localId: null
            })
        } finally {
            engine.stop()
        }
    })
})
