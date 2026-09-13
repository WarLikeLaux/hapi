import type { ThreadAssistantMessagePart } from '@assistant-ui/react'

export type ResponsePartPartition = {
    visibleIndices: number[]
    detailIndices: number[]
}

export function shouldCompactResponse(
    statusType: string | undefined,
    isLast: boolean,
    threadIsRunning?: boolean,
): boolean {
    // An interrupted reconnect can leave an old tool call without its result,
    // making assistant-ui label that historical response as requires-action.
    // Once a newer message exists it is no longer live and is safe to compact.
    if (!isLast) return true

    // The last joined response can have the same stale requires-action status.
    // The thread-level state is authoritative here: once the session is idle,
    // a response with a final text part is complete even if one tool result was
    // lost during a reconnect.
    if (threadIsRunning !== undefined) return !threadIsRunning

    return statusType === 'complete'
}

function isResultArtifact(part: ThreadAssistantMessagePart): boolean {
    return part.type === 'tool-call' && part.toolName === 'GeneratedImage'
}

/**
 * Keep the final prose answer (plus user-facing generated media) in the chat.
 * Reasoning, tool activity, and any superseded intermediate prose move into
 * the per-response details dialog once the response is complete.
 */
export function partitionCompletedResponseParts(
    parts: readonly ThreadAssistantMessagePart[],
): ResponsePartPartition | null {
    const finalTextIndex = parts.findLastIndex((part) => (
        part.type === 'text' && part.text.trim().length > 0
    ))
    if (finalTextIndex < 0) return null

    const hasWorkDetails = parts.some((part) => (
        part.type === 'reasoning'
        || (part.type === 'tool-call' && !isResultArtifact(part))
    ))
    if (!hasWorkDetails) return null

    const visibleIndices: number[] = []
    const detailIndices: number[] = []
    parts.forEach((part, index) => {
        if (index === finalTextIndex || isResultArtifact(part)) {
            visibleIndices.push(index)
        } else {
            detailIndices.push(index)
        }
    })

    return detailIndices.length > 0
        ? { visibleIndices, detailIndices }
        : null
}
