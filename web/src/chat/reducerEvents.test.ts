import { describe, expect, it } from 'vitest'
import { parseMessageAsEvent } from './reducerEvents'
import type { NormalizedMessage } from './types'

function makeAgentTextMessage(text: string): NormalizedMessage {
    return {
        role: 'agent',
        content: [{ type: 'text', text, uuid: 'u1', parentUUID: null }],
        id: 'msg-1',
        localId: null,
        createdAt: Date.now(),
        isSidechain: false,
    }
}

describe('parseMessageAsEvent — usage limit formats', () => {
    it('parses reached with limitType', () => {
        const msg = makeAgentTextMessage('Claude AI usage limit reached|1774278000|five_hour')
        expect(parseMessageAsEvent(msg)).toEqual({
            type: 'limit-reached',
            endsAt: 1774278000,
            limitType: 'five_hour',
        })
    })

    it('parses reached without limitType (backward compat)', () => {
        const msg = makeAgentTextMessage('Claude AI usage limit reached|1774278000')
        expect(parseMessageAsEvent(msg)).toEqual({
            type: 'limit-reached',
            endsAt: 1774278000,
            limitType: '',
        })
    })

    it('parses warning with five_hour type', () => {
        const msg = makeAgentTextMessage('Claude AI usage limit warning|1774278000|90|five_hour')
        expect(parseMessageAsEvent(msg)).toEqual({
            type: 'limit-warning',
            utilization: 0.9,
            endsAt: 1774278000,
            limitType: 'five_hour',
        })
    })

    it('parses warning with seven_day type', () => {
        const msg = makeAgentTextMessage('Claude AI usage limit warning|1774850400|85|seven_day')
        expect(parseMessageAsEvent(msg)).toEqual({
            type: 'limit-warning',
            utilization: 0.85,
            endsAt: 1774850400,
            limitType: 'seven_day',
        })
    })

    it('handles missing limitType', () => {
        const msg = makeAgentTextMessage('Claude AI usage limit warning|1774278000|100|')
        expect(parseMessageAsEvent(msg)).toEqual({
            type: 'limit-warning',
            utilization: 1,
            endsAt: 1774278000,
            limitType: '',
        })
    })

    it('returns null for non-limit text', () => {
        const msg = makeAgentTextMessage('Hello world')
        expect(parseMessageAsEvent(msg)).toBeNull()
    })

    it('returns null for sidechain messages', () => {
        const msg = makeAgentTextMessage('Claude AI usage limit reached|1774278000')
        msg.isSidechain = true
        expect(parseMessageAsEvent(msg)).toBeNull()
    })
})

describe('suppressResolvedRetryErrors', () => {
    it('suppresses intermediate retry error when an agent message exists in the turn', async () => {
        const { suppressResolvedRetryErrors } = await import('./reducerEvents')
        const blocks: any[] = [
            { kind: 'user-text', id: 'u1', text: 'Hello', createdAt: 1 },
            { kind: 'agent-text', id: 'a1', text: 'Successful answer', createdAt: 2 },
            {
                kind: 'agent-event',
                id: 'e1',
                createdAt: 3,
                event: {
                    type: 'error',
                    message: 'Your previous response was blocked by content safety filters: Prompt/response was blocked by Google Safety Filters. Retries remaining: 3',
                },
            },
            { kind: 'agent-event', id: 'e2', createdAt: 4, event: { type: 'ready' } },
        ]

        const filtered = suppressResolvedRetryErrors(blocks)
        expect(filtered.map((b) => b.id)).toEqual(['u1', 'a1', 'e2'])
    })

    it('preserves retry error when no agent message exists in the turn (all retries failed)', async () => {
        const { suppressResolvedRetryErrors } = await import('./reducerEvents')
        const blocks: any[] = [
            { kind: 'user-text', id: 'u1', text: 'Hello', createdAt: 1 },
            {
                kind: 'agent-event',
                id: 'e1',
                createdAt: 2,
                event: {
                    type: 'error',
                    message: 'Your previous response was blocked by content safety filters. Retries remaining: 0',
                },
            },
        ]

        const filtered = suppressResolvedRetryErrors(blocks)
        expect(filtered.map((b) => b.id)).toEqual(['u1', 'e1'])
    })

    it('preserves non-retry errors even if an agent message exists', async () => {
        const { suppressResolvedRetryErrors } = await import('./reducerEvents')
        const blocks: any[] = [
            { kind: 'user-text', id: 'u1', text: 'Hello', createdAt: 1 },
            { kind: 'agent-text', id: 'a1', text: 'Partial answer', createdAt: 2 },
            {
                kind: 'agent-event',
                id: 'e1',
                createdAt: 3,
                event: {
                    type: 'error',
                    message: 'turn limit reached',
                },
            },
        ]

        const filtered = suppressResolvedRetryErrors(blocks)
        expect(filtered.map((b) => b.id)).toEqual(['u1', 'a1', 'e1'])
    })
})
