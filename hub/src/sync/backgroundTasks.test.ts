import { describe, expect, it } from 'bun:test'
import { extractBackgroundTaskDelta } from './backgroundTasks'

/** Agent output envelope the CLI sends over the `message` socket event. */
function agentOutput(data: unknown) {
    return { role: 'agent', content: { type: 'output', data } }
}

/** Codex-family envelope (`codex`/minimax/gemini/opencode/pi/kimi/cursor/grok/copilot/dsh). */
function codexEnvelope(data: unknown) {
    return { role: 'agent', content: { type: 'codex', data } }
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

    describe('codex-family envelope', () => {
        it('ignores ordinary foreground tool calls (no background-shell signal)', () => {
            expect(extractBackgroundTaskDelta(codexEnvelope({
                type: 'tool-call',
                callId: 'call_001',
                name: 'bash',
                status: 'in_progress'
            }))).toBeNull()
            expect(extractBackgroundTaskDelta(codexEnvelope({
                type: 'tool-call-result',
                callId: 'call_001',
                output: { content: [{ type: 'text', text: 'ok' }] },
                is_error: false
            }))).toBeNull()
        })

        it('ignores pending and completed tool-call status updates', () => {
            // pending updates arrive multiple times per callId before work starts —
            // skipping them keeps the counter balanced with the single result event.
            expect(extractBackgroundTaskDelta(codexEnvelope({
                type: 'tool-call', callId: 'call_001', name: 'bash', status: 'pending'
            }))).toBeNull()
            expect(extractBackgroundTaskDelta(codexEnvelope({
                type: 'tool-call', callId: 'call_001', name: 'bash', status: 'completed'
            }))).toBeNull()
            expect(extractBackgroundTaskDelta(codexEnvelope({
                type: 'tool-call', callId: 'call_001', name: 'bash', status: 'failed'
            }))).toBeNull()
        })

        it('ignores non tool-call messages inside the codex envelope', () => {
            expect(extractBackgroundTaskDelta(codexEnvelope({
                type: 'message', message: 'thinking...'
            }))).toBeNull()
            expect(extractBackgroundTaskDelta(codexEnvelope({
                type: 'reasoning', message: 'reasoning text'
            }))).toBeNull()
        })

        it('returns null for non-codex payload types (legacy + unknown)', () => {
            expect(extractBackgroundTaskDelta({
                role: 'agent', content: { type: 'text', data: { type: 'tool-call' } }
            })).toBeNull()
            expect(extractBackgroundTaskDelta({
                role: 'agent', content: { type: 'something-else', data: {} }
            })).toBeNull()
        })

        it('keeps a full tool lifecycle at a zero delta', () => {
            // A full ACP tool lifecycle (pending/in_progress/completed/result)
            // is ordinary foreground work and must leave the counter untouched.
            const events = [
                { type: 'tool-call', status: 'pending' },
                { type: 'tool-call', status: 'pending' },
                { type: 'tool-call', status: 'in_progress' },
                { type: 'tool-call', status: 'completed' },
                { type: 'tool-call-result' }
            ] as const
            let started = 0
            let completed = 0
            for (const data of events) {
                const delta = extractBackgroundTaskDelta(codexEnvelope(data))
                if (delta) {
                    started += delta.started
                    completed += delta.completed
                }
            }
            expect({ started, completed }).toEqual({ started: 0, completed: 0 })
        })
    })
})
