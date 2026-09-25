import { describe, expect, it } from 'bun:test'
import { extractBackgroundTaskDelta } from './backgroundTasks'

/** Agent output envelope the CLI sends over the `message` socket event. */
function agentOutput(data: unknown) {
    return { role: 'agent', content: { type: 'output', data } }
}

/** Log-format tool_result entry exactly as claude's sdkToLogConverter emits it. */
function claudeToolResult(blocks: unknown[], extras: Record<string, unknown> = {}) {
    return agentOutput({
        type: 'user',
        isSidechain: false,
        message: { role: 'user', content: blocks },
        ...extras
    })
}

function toolResultBlock(content: string) {
    return { type: 'tool_result', tool_use_id: 'call_1', content }
}

describe('extractBackgroundTaskDelta', () => {
    it('counts a claude-style background shell start from a user entry', () => {
        const delta = extractBackgroundTaskDelta(
            agentOutput({
                type: 'user',
                message: {
                    role: 'user',
                    content: [toolResultBlock('Command running in background with ID: bash_1')]
                }
            })
        )
        expect(delta).toEqual({ started: 1, completed: 0 })
    })

    it('counts an async agent launch ack as a start', () => {
        const delta = extractBackgroundTaskDelta(
            claudeToolResult([
                toolResultBlock(
                    'Async agent launched successfully. (This tool result is internal metadata)\nagentId: abc123'
                )
            ])
        )
        expect(delta).toEqual({ started: 1, completed: 0 })
    })

    it('does not count the agent-launch marker quoted mid-content', () => {
        const delta = extractBackgroundTaskDelta(
            claudeToolResult([
                toolResultBlock('Some file content\nAsync agent launched successfully somewhere in the text')
            ])
        )
        expect(delta).toBeNull()
    })

    it('does not count the shell marker quoted by git diff or file reads', () => {
        const delta = extractBackgroundTaskDelta(
            claudeToolResult([
                toolResultBlock("diff --git a/hub/src/sync/backgroundTasks.ts\n+const MARKERS = ['Command running in background with ID:']")
            ])
        )
        expect(delta).toBeNull()
    })

    it('counts a shell ack with leading whitespace', () => {
        const delta = extractBackgroundTaskDelta(
            claudeToolResult([
                toolResultBlock('\n  Command running in background with ID: bash_1')
            ])
        )
        expect(delta).toEqual({ started: 1, completed: 0 })
    })

    it('counts multiple starts in one entry', () => {
        const delta = extractBackgroundTaskDelta(
            claudeToolResult([
                toolResultBlock('Async agent launched successfully'),
                toolResultBlock('Command running in background with ID: bash_2')
            ])
        )
        expect(delta).toEqual({ started: 2, completed: 0 })
    })

    it('ignores sidechain tool results', () => {
        const delta = extractBackgroundTaskDelta(
            claudeToolResult([toolResultBlock('Async agent launched successfully')], { isSidechain: true })
        )
        expect(delta).toBeNull()
    })

    it('counts a claude-style task-notification completion (string content)', () => {
        const delta = extractBackgroundTaskDelta(
            agentOutput({
                type: 'user',
                message: {
                    role: 'user',
                    content: '<task-notification>\n<task-id>abc</task-id>\n<status>completed</status>\n</task-notification>'
                }
            })
        )
        expect(delta).toEqual({ started: 0, completed: 1 })
    })

    it('returns null for plain conversation messages', () => {
        expect(extractBackgroundTaskDelta(
            agentOutput({
                type: 'assistant',
                message: { role: 'assistant', content: [{ type: 'text', text: 'Working on it' }] }
            })
        )).toBeNull()
        expect(extractBackgroundTaskDelta(
            agentOutput({
                type: 'user',
                message: { role: 'user', content: [toolResultBlock('Done, 3 files changed')] }
            })
        )).toBeNull()
    })

    it('returns null for user-role (human) envelopes', () => {
        expect(extractBackgroundTaskDelta({
            role: 'user',
            content: { type: 'text', text: 'Command running in background with ID:' }
        })).toBeNull()
    })
})
