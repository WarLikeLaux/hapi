import type { AgentEvent, AgentEventBlock, ChatBlock, NormalizedMessage } from '@/chat/types'

function parseClaudeUsageLimit(text: string): AgentEvent | null {
    const reachedMatch = text.match(/^Claude AI usage limit reached\|(\d+)(?:\|([^|]*))?$/)
    if (reachedMatch) {
        const timestamp = Number.parseInt(reachedMatch[1], 10)
        if (Number.isFinite(timestamp)) {
            return { type: 'limit-reached', endsAt: timestamp, limitType: reachedMatch[2] || '' }
        }
    }

    const warningMatch = text.match(/^Claude AI usage limit warning\|(\d+)\|(\d+)\|([^|]*)$/)
    if (warningMatch) {
        const timestamp = Number.parseInt(warningMatch[1], 10)
        const utilization = Number.parseInt(warningMatch[2], 10) / 100
        const limitType = warningMatch[3] || ''
        if (Number.isFinite(timestamp) && Number.isFinite(utilization)) {
            return { type: 'limit-warning', utilization, endsAt: timestamp, limitType }
        }
    }

    return null
}

export function parseMessageAsEvent(msg: NormalizedMessage): AgentEvent | null {
    if (msg.isSidechain) return null
    if (msg.role !== 'agent') return null

    for (const content of msg.content) {
        if (content.type === 'text') {
            const limitEvent = parseClaudeUsageLimit(content.text)
            if (limitEvent !== null) {
                return limitEvent
            }
        }
    }

    return null
}

export function dedupeAgentEvents(blocks: ChatBlock[]): ChatBlock[] {
    const result: ChatBlock[] = []
    let prevEventKey: string | null = null
    let prevTitleChangedTo: string | null = null

    for (const block of blocks) {
        if (block.kind !== 'agent-event') {
            result.push(block)
            prevEventKey = null
            prevTitleChangedTo = null
            continue
        }

        const event = block.event as { type: string; [key: string]: unknown }
        if (event.type === 'title-changed' && typeof event.title === 'string') {
            const title = event.title.trim()
            const key = `title-changed:${title}`
            if (key === prevEventKey) {
                continue
            }
            result.push(block)
            prevEventKey = key
            prevTitleChangedTo = title
            continue
        }

        if (event.type === 'message' && typeof event.message === 'string') {
            const message = event.message.trim()
            const key = `message:${message}`
            if (key === prevEventKey) {
                continue
            }
            if (prevTitleChangedTo && message === prevTitleChangedTo) {
                continue
            }
            result.push(block)
            prevEventKey = key
            prevTitleChangedTo = null
            continue
        }

        if (event.type === 'error' && typeof event.message === 'string') {
            const message = event.message.trim()
            const key = `error:${message}`
            if (key === prevEventKey) {
                continue
            }
            result.push(block)
            prevEventKey = key
            prevTitleChangedTo = null
            continue
        }

        let key: string
        try {
            key = `event:${JSON.stringify(event)}`
        } catch {
            key = `event:${String(event.type)}`
        }

        if (key === prevEventKey) {
            continue
        }

        result.push(block)
        prevEventKey = key
        prevTitleChangedTo = null
    }

    return result
}

/**
 * Fold consecutive api-error events, keeping only the latest state.
 */
export function foldApiErrorEvents(blocks: ChatBlock[]): ChatBlock[] {
    const result: ChatBlock[] = []

    for (const block of blocks) {
        if (block.kind !== 'agent-event') {
            result.push(block)
            continue
        }

        const event = block.event as { type: string }
        if (event.type !== 'api-error') {
            result.push(block)
            continue
        }

        const prev = result[result.length - 1] as AgentEventBlock | undefined
        if (prev?.kind === 'agent-event' && (prev.event as { type: string }).type === 'api-error') {
            result[result.length - 1] = block
        } else {
            result.push(block)
        }
    }

    return result
}

/**
 * Test whether an error message is an intermediate retry diagnostic
 * (e.g. content safety filter retry notice) rather than a terminal failure.
 */
export function isIntermediateRetryMessage(message: unknown): boolean {
    if (typeof message !== 'string') return false
    return (
        /retries remaining/i.test(message)
        || /attempting to regenerate/i.test(message)
        || /your previous response was blocked/i.test(message)
        || /blocked by (?:content|google) safety filters/i.test(message)
    )
}

/**
 * Suppress intermediate retry error events (e.g. content safety filter retries)
 * when the turn succeeded in producing an agent response.
 */
export function suppressResolvedRetryErrors(blocks: ChatBlock[]): ChatBlock[] {
    // Partition blocks by user turn (bounded by user-text blocks).
    // If a turn contains an agent response (agent-text, agent-reasoning, or assistant cli-output),
    // any intermediate retry error events within that turn are suppressed.
    const turns: ChatBlock[][] = []
    let currentTurn: ChatBlock[] = []

    for (const block of blocks) {
        if (block.kind === 'user-text' && currentTurn.length > 0) {
            turns.push(currentTurn)
            currentTurn = []
        }
        currentTurn.push(block)
    }
    if (currentTurn.length > 0) {
        turns.push(currentTurn)
    }

    const result: ChatBlock[] = []
    for (const turn of turns) {
        const hasAgentResponse = turn.some(
            (b) => b.kind === 'agent-text'
                || b.kind === 'agent-reasoning'
                || (b.kind === 'cli-output' && b.source === 'assistant')
        )
        for (const block of turn) {
            if (
                hasAgentResponse
                && block.kind === 'agent-event'
                && (block.event as { type: string }).type === 'error'
                && isIntermediateRetryMessage((block.event as { message?: unknown }).message)
            ) {
                continue
            }
            result.push(block)
        }
    }

    return result
}
