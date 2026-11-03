import { getExternalStoreMessages, type ThreadAssistantMessagePart, type ThreadMessageLike } from '@assistant-ui/react'
import { isAskUserQuestionToolName } from '@/components/ToolCard/askUserQuestion'
import { isRequestUserInputToolName } from '@/components/ToolCard/requestUserInput'
import type { ToolCallBlock } from '@/chat/types'
import type { GeneratedImageBlock } from '@/chat/types'

export type ResponsePartPartition = {
    visibleIndices: number[]
    detailIndices: number[]
}

export function hasRenderableResponsePart(
    parts: readonly ThreadAssistantMessagePart[],
): boolean {
    return parts.some((part) => {
        if (part.type === 'text' || part.type === 'reasoning') {
            return part.text.trim().length > 0
        }

        return true
    })
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

export function isAgentImageInspection(part: ThreadAssistantMessagePart): boolean {
    if (part.type !== 'tool-call' || part.toolName !== 'DisplayedAttachment') return false
    const block = part.artifact as GeneratedImageBlock | undefined
    return block?.kind === 'generated-image'
        && block.source?.ingress === 'tool_result'
        && block.source.toolName === 'view_image'
}

function isResultArtifact(part: ThreadAssistantMessagePart): boolean {
    return (part.type === 'tool-call' && part.toolName === 'DisplayedAttachment' && !isAgentImageInspection(part))
        || (part.type === 'data' && part.name === 'recap')
}

function isUserFacingPart(part: ThreadAssistantMessagePart): boolean {
    // Public prose has no reliable "waiting for reply" marker. Keep it all,
    // including requests without a question mark; never infer pending state.
    if (part.type === 'text' || isResultArtifact(part)) return true
    if (part.type !== 'tool-call') return false
    const block = part.artifact as ToolCallBlock | undefined
    return isAskUserQuestionToolName(part.toolName)
        || isRequestUserInputToolName(part.toolName)
        || part.toolName === 'ExitPlanMode'
        || part.toolName === 'exit_plan_mode'
        || (block?.kind === 'tool-call' && block.tool.permission?.status === 'pending')
}

/**
 * Public messages and decision cards stay in the transcript, including their
 * answered history. Only internal work goes into the per-response dialog.
 */
export function partitionCompletedResponseParts(
    parts: readonly ThreadAssistantMessagePart[],
): ResponsePartPartition | null {
    const visibleIndices: number[] = []
    const detailIndices: number[] = []
    const phases = parts.map(part => {
        if (part.type !== 'text') return undefined
        const source = getExternalStoreMessages<ThreadMessageLike>(part)[0]
        return (source?.metadata?.custom as { phase?: string } | undefined)?.phase
    })
    parts.forEach((part, index) => {
        const completedCommentary = phases[index] === 'commentary' && phases.slice(index + 1).includes('final_answer')
        if (!completedCommentary && isUserFacingPart(part)) {
            visibleIndices.push(index)
        } else {
            detailIndices.push(index)
        }
    })

    return detailIndices.length > 0 && (visibleIndices.length > 0 || parts.some(isAgentImageInspection))
        ? { visibleIndices, detailIndices }
        : null
}
