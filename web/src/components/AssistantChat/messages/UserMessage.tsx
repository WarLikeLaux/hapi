import { MessagePrimitive, useAuiState, type TextMessagePart } from '@assistant-ui/react'
import { useHappyChatContext } from '@/components/AssistantChat/context'
import type { HappyChatMessageMetadata } from '@/lib/assistant-runtime'
import { MessageStatusIndicator } from '@/components/AssistantChat/messages/MessageStatusIndicator'
import { MessageAttachments } from '@/components/AssistantChat/messages/MessageAttachments'
import { UserBubbleContent, getUserBubbleClassName, shouldShowMessageStatus } from '@/components/AssistantChat/messages/user-bubble'
import { CliOutputBlock } from '@/components/CliOutputBlock'
import { getConversationMessageAnchorId } from '@/chat/outline'
import { useTranslation } from '@/lib/use-translation'
import { MessageTimestamp } from '@/components/AssistantChat/messages/MessageTimestamp'

export function HappyUserMessage() {
    const ctx = useHappyChatContext()
    const { t } = useTranslation()
    const role = useAuiState((s) => s.message.role)
    const messageId = useAuiState((s) => s.message.id)
    const elementId = getConversationMessageAnchorId(messageId)
    const text = useAuiState((s) => {
        if (s.message.role !== 'user') return ''
        return s.message.content.find((part): part is TextMessagePart => part.type === 'text')?.text ?? ''
    })
    const status = useAuiState((s) => {
        if (s.message.role !== 'user') return undefined
        const custom = s.message.metadata.custom as Partial<HappyChatMessageMetadata> | undefined
        return custom?.status
    })
    const localId = useAuiState((s) => {
        if (s.message.role !== 'user') return null
        const custom = s.message.metadata.custom as Partial<HappyChatMessageMetadata> | undefined
        return custom?.localId ?? null
    })
    const attachments = useAuiState((s) => {
        if (s.message.role !== 'user') return undefined
        const custom = s.message.metadata.custom as Partial<HappyChatMessageMetadata> | undefined
        return custom?.attachments
    })
    const isCliOutput = useAuiState((s) => {
        const custom = s.message.metadata.custom as Partial<HappyChatMessageMetadata> | undefined
        return custom?.kind === 'cli-output'
    })
    const steered = useAuiState(({ message }) => (
        message.metadata.custom as Partial<HappyChatMessageMetadata> | undefined
    )?.steered === true)
    const cliText = useAuiState((s) => {
        const custom = s.message.metadata.custom as Partial<HappyChatMessageMetadata> | undefined
        if (custom?.kind !== 'cli-output') return ''
        return s.message.content.find((part): part is TextMessagePart => part.type === 'text')?.text ?? ''
    })
    if (role !== 'user') return null
    const canRetry = status === 'failed' && typeof localId === 'string' && Boolean(ctx.onRetryMessage)
    const onRetry = canRetry ? () => ctx.onRetryMessage!(localId) : undefined
    const showStatus = shouldShowMessageStatus(status)

    if (isCliOutput) {
        return (
            <MessagePrimitive.Root
                id={elementId}
                data-hapi-message-role="user"
                className="happy-message scroll-mt-4 px-1 min-w-0 max-w-full overflow-x-hidden"
            >
                <div className="ml-auto w-full max-w-[92%]">
                    <CliOutputBlock text={cliText} />
                </div>
            </MessagePrimitive.Root>
        )
    }

    const hasText = text.length > 0
    const hasAttachments = attachments && attachments.length > 0

    return (
        <MessagePrimitive.Root
            id={elementId}
            data-hapi-message-role="user"
            className="happy-message flex flex-col items-end scroll-mt-4"
        >
            <div className={getUserBubbleClassName(status)}>
                <div className="flex items-end gap-2">
                    <div className="min-w-0 flex-1">
                        {hasText ? <UserBubbleContent text={text} /> : null}
                        {hasAttachments ? <MessageAttachments attachments={attachments} /> : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-1 pb-0.5">
                        <MessageTimestamp className="text-[10px] leading-none opacity-60" />
                        {showStatus ? <MessageStatusIndicator status={status} onRetry={onRetry} /> : null}
                    </div>
                </div>
                {steered ? (
                    <span
                        title={t('queuedMessages.steeredBadgeTitle')}
                        className="mt-1 inline-flex items-center gap-0.5 text-[10px] leading-none text-[var(--app-hint)]"
                    >
                        {t('queuedMessages.steeredBadge')}
                    </span>
                ) : null}
            </div>
        </MessagePrimitive.Root>
    )
}
