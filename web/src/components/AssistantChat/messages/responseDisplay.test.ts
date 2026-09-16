import { describe, expect, it } from 'vitest'
import type { ThreadAssistantMessagePart } from '@assistant-ui/react'
import {
    hasRenderableResponsePart,
    partitionCompletedResponseParts,
    shouldCompactResponse,
} from './responseDisplay'

describe('hasRenderableResponsePart', () => {
    it('keeps actions hidden before the assistant produces visible activity', () => {
        expect(hasRenderableResponsePart([])).toBe(false)
        expect(hasRenderableResponsePart([
            { type: 'text', text: '   ' },
            { type: 'reasoning', text: '' },
        ])).toBe(false)
    })

    it('shows actions after text, reasoning, or a tool call appears', () => {
        expect(hasRenderableResponsePart([{ type: 'text', text: 'Hello' }])).toBe(true)
        expect(hasRenderableResponsePart([{ type: 'reasoning', text: 'Thinking' }])).toBe(true)
        expect(hasRenderableResponsePart([
            { type: 'tool-call', toolCallId: 'tool-1', toolName: 'Read', args: {}, argsText: '{}' },
        ])).toBe(true)
    })
})

describe('shouldCompactResponse', () => {
    it('compacts completed responses including the latest one', () => {
        expect(shouldCompactResponse('complete', true)).toBe(true)
    })

    it('compacts historical responses left in requires-action state', () => {
        expect(shouldCompactResponse('requires-action', false)).toBe(true)
    })

    it('compacts the latest response once the thread is idle despite stale status', () => {
        expect(shouldCompactResponse('requires-action', true, false)).toBe(true)
        expect(shouldCompactResponse('running', true, false)).toBe(true)
    })

    it('keeps the current response expanded while the thread is running', () => {
        expect(shouldCompactResponse('complete', true, true)).toBe(false)
        expect(shouldCompactResponse('requires-action', true, true)).toBe(false)
    })
})

describe('partitionCompletedResponseParts', () => {
    it('keeps only the final prose answer in the chat', () => {
        const parts = [
            { type: 'reasoning', text: 'Thinking' },
            { type: 'tool-call', toolCallId: 'tool-1', toolName: 'Read', args: {}, argsText: '{}' },
            { type: 'text', text: 'Intermediate update' },
            { type: 'text', text: 'Final answer' },
        ] satisfies ThreadAssistantMessagePart[]

        expect(partitionCompletedResponseParts(parts)).toEqual({
            visibleIndices: [3],
            detailIndices: [0, 1, 2],
        })
    })

    it('keeps generated media beside the final answer', () => {
        const parts = [
            { type: 'reasoning', text: 'Thinking' },
            { type: 'tool-call', toolCallId: 'image-1', toolName: 'GeneratedImage', args: {}, argsText: '{}' },
            { type: 'text', text: 'Done' },
        ] satisfies ThreadAssistantMessagePart[]

        expect(partitionCompletedResponseParts(parts)).toEqual({
            visibleIndices: [1, 2],
            detailIndices: [0],
        })
    })

    it('leaves ordinary text-only responses unchanged', () => {
        const parts = [
            { type: 'text', text: 'First paragraph' },
            { type: 'text', text: 'Second paragraph' },
        ] satisfies ThreadAssistantMessagePart[]

        expect(partitionCompletedResponseParts(parts)).toBeNull()
    })

    it('leaves tool-only responses unchanged when there is no final answer', () => {
        const parts = [
            { type: 'tool-call', toolCallId: 'tool-1', toolName: 'Read', args: {}, argsText: '{}' },
        ] satisfies ThreadAssistantMessagePart[]

        expect(partitionCompletedResponseParts(parts)).toBeNull()
    })
})
