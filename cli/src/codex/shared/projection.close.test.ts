import { describe, expect, it, vi } from 'vitest'
import type { ApiSessionClient } from '@/api/apiSession'
import { SharedCodexProjection } from './projection'

describe('shared Codex self close', () => {
    it.each([
        { parent: undefined, failed: false, expected: 1 },
        { parent: 'parent', failed: false, expected: 0 },
        { parent: undefined, failed: true, expected: 0 },
    ])('only applies successful live root requests ($parent, failed=$failed)', async ({ parent, failed, expected }) => {
        const requestCloseAfterTurn = vi.fn(async () => {})
        const session = {
            getMetadata: () => ({}), updateAgentState: vi.fn(), updateMetadata: vi.fn(),
            sendAgentMessage: vi.fn(), requestCloseAfterTurn,
        } as unknown as ApiSessionClient
        const projection = new SharedCodexProjection(session, 'thread', async () => {}, parent)
        const item = { id: 'close', type: 'mcpToolCall', server: 'hapi', tool: 'close_session',
            arguments: {}, status: 'completed', result: { content: [], isError: failed } }
        const params = { threadId: 'thread', turnId: 'turn', item }
        await projection.history({ turns: [{ id: 'turn', status: 'completed', items: [item] }] })
        expect(requestCloseAfterTurn).not.toHaveBeenCalled()
        await projection.notification('item/completed', params)
        await projection.notification('item/completed', params)
        projection.reset()
        await projection.history({ turns: [{ id: 'turn', status: 'completed', items: [item] }] })
        expect(requestCloseAfterTurn).toHaveBeenCalledTimes(expected)
    })
})
