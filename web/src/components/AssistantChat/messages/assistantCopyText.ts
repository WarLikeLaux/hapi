import type { ThreadAssistantMessagePart } from '@assistant-ui/react'
import { stripNotifySummaryFooter } from '@hapi/protocol/messages'

export function getAssistantCopyText(
    parts: readonly ThreadAssistantMessagePart[],
    options?: { stripNotifySummary?: boolean }
): string {
    const strip = options?.stripNotifySummary === true
    return parts
        .map((part) => {
            if (part.type === 'data' && part.name === 'recap') {
                const data = part.data as { text?: unknown } | null
                return typeof data?.text === 'string' && data.text.trim() ? `recap: ${data.text.trim()}` : ''
            }
            if (part.type !== 'text') return ''
            const trimmed = part.text.trim()
            return strip ? stripNotifySummaryFooter(trimmed) : trimmed
        })
        .filter((text) => text.length > 0)
        .join('\n\n')
}
