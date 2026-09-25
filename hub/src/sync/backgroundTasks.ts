import { isObject } from '@hapi/protocol'
import { unwrapRoleWrappedRecordEnvelope } from '@hapi/protocol/messages'

/**
 * Extract background task start/completion signals from a message.
 *
 * Uses role-aware parsing to avoid false positives:
 *  - Started:   agent-role output with a tool_result starting with
 *               "Command running in background with ID:" (background shell),
 *               or "Async agent launched successfully" (async subagent ack)
 *  - Completed: agent-role output wrapping a user-type message (system-injected)
 *               starting with "<task-notification>"
 *
 * Both signals arrive as { role: 'agent', content: { type: 'output', data: {...} } }
 * because the CLI wraps all messages in agent envelopes. Claude (SDK and local
 * transcript shapes alike) carries tool_result blocks inside `type:'user'`
 * entries with an array `message.content`, so that shape must be scanned too —
 * missing it silently never counted claude background starts.
 */
export function extractBackgroundTaskDelta(messageContent: unknown): { started: number; completed: number } | null {
    const record = unwrapRoleWrappedRecordEnvelope(messageContent)
    if (!record || record.role !== 'agent') return null
    if (!isObject(record.content) || record.content.type !== 'output') return null

    const data = isObject(record.content.data) ? record.content.data : null
    if (!data) return null

    const started = countTaskStarts(record.content)
    const completed = data.type === 'user' ? countTaskCompletions(data) : 0

    if (started === 0 && completed === 0) return null
    return { started, completed }
}

/**
 * Count background task starts from tool_result blocks.
 */
function countTaskStarts(content: Record<string, unknown>): number {
    const data = isObject(content.data) ? content.data : null
    if (!data) return 0

    // Sidechain (subagent-internal) tool results are interior detail: the
    // spawning subagent's own task-notification fires only after its children
    // settle, so counting nested launches here would double-book work the
    // main thread never sees as outstanding.
    if (data.isSidechain === true) return 0

    // Direct tool_result
    if (data.type === 'tool_result') {
        return isBackgroundStartResult(data) ? 1 : 0
    }

    // Log-format user or assistant entry whose message content array holds
    // tool_result blocks. Claude SDK tool results stream as `user` entries;
    // some scrapers emit them as `assistant`.
    if (data.type === 'user' || data.type === 'assistant') {
        const message = isObject(data.message) ? data.message : null
        const modelContent = message?.content
        if (!Array.isArray(modelContent)) return 0

        let count = 0
        for (const block of modelContent) {
            if (isObject(block) && block.type === 'tool_result' && isBackgroundStartResult(block)) {
                count++
            }
        }
        return count
    }

    return 0
}

/**
 * Text markers a tool harness puts at the very start of a tool_result when
 * work is deferred to the background. Both are start-anchored on purpose:
 * transcripts constantly quote these phrases mid-content (agents Read this
 * very source, git diff echoes it), and a substring match once counted a
 * session's own self-review diff as a running background shell. Real acks
 * own the whole tool_result (verified against live claude transcripts), so
 * an anchored match cannot miss them.
 */
const BACKGROUND_START_PREFIXES = [
    'Command running in background with ID:',
    'Async agent launched successfully'
]

function isBackgroundStartResult(block: Record<string, unknown>): boolean {
    const text = typeof block.content === 'string'
        ? block.content
        : Array.isArray(block.content)
            ? block.content.map((c: unknown) => isObject(c) && typeof c.text === 'string' ? c.text : '').join('')
            : ''
    const trimmedStart = text.trimStart()
    return BACKGROUND_START_PREFIXES.some((prefix) => trimmedStart.startsWith(prefix))
}

/**
 * Count task completions from system-injected user messages.
 *
 * These arrive as: { type: 'user', message: { content: '<task-notification>...' } }
 * inside the agent output envelope.
 */
function countTaskCompletions(data: Record<string, unknown>): number {
    // { type: 'user', message: { content: '<task-notification>...' } }
    if (isObject(data.message)) {
        const msg = data.message as Record<string, unknown>
        if (typeof msg.content === 'string' && msg.content.trimStart().startsWith('<task-notification>')) {
            return 1
        }
    }

    // { type: 'user', uuid: '...', content: '<task-notification>...' }
    if (typeof data.content === 'string' && data.content.trimStart().startsWith('<task-notification>')) {
        return 1
    }

    return 0
}
