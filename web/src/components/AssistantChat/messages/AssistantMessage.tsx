import { useEffect, useMemo, useState, type PropsWithChildren } from 'react'
import { MessagePrimitive, useAuiState, type TextMessagePart, type ThreadAssistantMessagePart } from '@assistant-ui/react'
import { Reasoning, ReasoningGroup } from '@/components/assistant-ui/reasoning'
import { HappyToolMessage } from '@/components/AssistantChat/messages/ToolMessage'
import { CliOutputBlock } from '@/components/CliOutputBlock'
import type { HappyChatMessageMetadata } from '@/lib/assistant-runtime'
import { getAssistantCopyText } from '@/components/AssistantChat/messages/assistantCopyText'
import { getConversationMessageAnchorId } from '@/chat/outline'
import { CodexReviewCard } from '@/components/AssistantChat/messages/CodexReviewCard'
import { MessageActions } from '@/components/AssistantChat/messages/MessageActions'
import { useHappyChatContext } from '@/components/AssistantChat/context'
import { NotifySummaryText } from '@/components/AssistantChat/messages/NotifySummaryText'
import { useSessionSummaryInChat } from '@/hooks/useSessionSummaryInChat'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/lib/use-translation'
import { partitionCompletedResponseParts, shouldCompactResponse } from './responseDisplay'
import { ResponseChanges } from './ResponseChanges'

const TOOL_COMPONENTS = {
    Fallback: HappyToolMessage
} as const

const MESSAGE_PART_COMPONENTS = {
    Text: NotifySummaryText,
    Reasoning: Reasoning,
    ReasoningGroup: ReasoningGroup,
    tools: TOOL_COMPONENTS
} as const

function DetailPartsGroup({ children }: PropsWithChildren) {
    return <div className="flex min-w-0 flex-col gap-3">{children}</div>
}

const DETAIL_PART_COMPONENTS = {
    Text: NotifySummaryText,
    Reasoning,
    tools: TOOL_COMPONENTS,
    Group: DetailPartsGroup,
} as const

function WorkIcon({ className }: { className?: string }) {
    return (
        <svg
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            className={className}
            aria-hidden="true"
        >
            <path d="M4 5.5h12M4 10h8M4 14.5h10" />
            <circle cx="15.5" cy="10" r="1" fill="currentColor" stroke="none" />
        </svg>
    )
}

export function HappyAssistantMessage() {
    const ctx = useHappyChatContext()
    const { t } = useTranslation()
    const showSessionSummaryInChat = useSessionSummaryInChat()
    const [workOpen, setWorkOpen] = useState(false)
    const messageId = useAuiState((s) => s.message.id)
    const messageParts = useAuiState((s) => (
        s.message.role === 'assistant'
            ? s.message.content
            : []
    ) as readonly ThreadAssistantMessagePart[])
    const messageStatus = useAuiState((s) => s.message.status)
    const isLastMessage = useAuiState((s) => s.message.isLast)
    const threadIsRunning = useAuiState((s) => s.thread.isRunning)
    const compactParts = useMemo(
        () => shouldCompactResponse(messageStatus?.type, isLastMessage, threadIsRunning)
            ? partitionCompletedResponseParts(messageParts)
            : null,
        [isLastMessage, messageParts, messageStatus?.type, threadIsRunning]
    )
    const visiblePartsGrouping = useMemo(
        () => () => compactParts
            ? [{ groupKey: 'visible-response', indices: compactParts.visibleIndices }]
            : [],
        [compactParts]
    )
    const detailPartsGrouping = useMemo(
        () => () => compactParts
            ? [{ groupKey: 'response-work', indices: compactParts.detailIndices }]
            : [],
        [compactParts]
    )
    const elementId = getConversationMessageAnchorId(messageId)
    const isCliOutput = useAuiState((s) => {
        const custom = s.message.metadata.custom as Partial<HappyChatMessageMetadata> | undefined
        return custom?.kind === 'cli-output'
    })
    const codexReview = useAuiState((s) => {
        const custom = s.message.metadata.custom as Partial<HappyChatMessageMetadata> | undefined
        return custom?.kind === 'codex-review' ? custom.review : undefined
    })
    const cliText = useAuiState((s) => {
        const custom = s.message.metadata.custom as Partial<HappyChatMessageMetadata> | undefined
        if (custom?.kind !== 'cli-output') return ''
        return s.message.content.find((part): part is TextMessagePart => part.type === 'text')?.text ?? ''
    })
    const toolOnly = useAuiState((s) => {
        if (s.message.role !== 'assistant') return false
        const parts = s.message.content
        return parts.length > 0 && parts.every((part) => part.type === 'tool-call')
    })
    const copyText = useAuiState((s) => {
        if (s.message.role !== 'assistant') return ''
        return getAssistantCopyText(s.message.content, {
            stripNotifySummary: !showSessionSummaryInChat
        })
    })

    const durationMs = useAuiState(({ message }) => (message.metadata.custom as Partial<HappyChatMessageMetadata> | undefined)?.durationMs)
    const usage = useAuiState(({ message }) => (message.metadata.custom as Partial<HappyChatMessageMetadata> | undefined)?.usage)
    const messageModel = useAuiState(({ message }) => (message.metadata.custom as Partial<HappyChatMessageMetadata> | undefined)?.model)
    const turnCount = useAuiState(({ message }) => (message.metadata.custom as Partial<HappyChatMessageMetadata> | undefined)?.turnCount)
    const roundSummary = useAuiState(({ message }) => (message.metadata.custom as Partial<HappyChatMessageMetadata> | undefined)?.roundSummary)
    const workspaceChanges = roundSummary?.workspaceChanges

    const metadata = { durationMs, usage, model: messageModel ?? null, turnCount, roundSummary }

    const history = ctx.metadata?.capabilities?.conversationHistory
    const showForkCurrent = Boolean(
        history?.forkCurrent
        && ctx.isLatestCompletedBoundary?.(messageId)
        && !ctx.disabled
        && ctx.onForkConversation
    )

    const rootClass = toolOnly
        ? 'py-1 min-w-0 max-w-full overflow-x-hidden'
        : 'px-1 min-w-0 max-w-full overflow-x-hidden'

    useEffect(() => {
        if (!compactParts) setWorkOpen(false)
    }, [compactParts])

    return (
        <MessagePrimitive.Root
            id={elementId}
            data-hapi-message-role="assistant"
            className={`happy-message ${rootClass} scroll-mt-4`}
        >
            {isCliOutput
                ? <CliOutputBlock text={cliText} />
                : codexReview
                    ? <CodexReviewCard review={codexReview} />
                    : compactParts
                        ? (
                            <MessagePrimitive.Unstable_PartsGrouped
                                groupingFunction={visiblePartsGrouping}
                                components={MESSAGE_PART_COMPONENTS}
                            />
                        )
                        : <MessagePrimitive.Content components={MESSAGE_PART_COMPONENTS} />}
            {compactParts || workspaceChanges ? (
                <>
                    <div className="mt-2 flex flex-wrap items-center gap-1" data-hapi-share-exclude="true">
                        {compactParts ? (
                            <button
                                type="button"
                                onClick={() => setWorkOpen(true)}
                                aria-haspopup="dialog"
                                className={cn(
                                    'inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs font-medium',
                                    'text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)]',
                                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)]'
                                )}
                            >
                                <WorkIcon className="h-4 w-4" />
                                <span>{t('session.responseWork.open')}</span>
                                <span aria-hidden="true" className="tabular-nums opacity-70">
                                    · {compactParts.detailIndices.length}
                                </span>
                            </button>
                        ) : null}
                        {workspaceChanges ? <ResponseChanges changes={workspaceChanges} /> : null}
                    </div>

                    {compactParts ? <Dialog open={workOpen} onOpenChange={setWorkOpen}>
                        <DialogContent className="flex max-h-[calc(100dvh-24px)] max-w-3xl flex-col overflow-hidden p-0 sm:max-h-[82vh]">
                            <DialogHeader className="shrink-0 border-b border-[var(--app-divider)] px-4 py-4 pr-14 text-left">
                                <DialogTitle>{t('session.responseWork.title')}</DialogTitle>
                            </DialogHeader>
                            <div
                                data-hapi-nested-scroll="true"
                                className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4"
                            >
                                <MessagePrimitive.Unstable_PartsGrouped
                                    groupingFunction={detailPartsGrouping}
                                    components={DETAIL_PART_COMPONENTS}
                                />
                            </div>
                        </DialogContent>
                    </Dialog> : null}
                </>
            ) : null}
            <MessageActions
                align="start"
                copyText={copyText || undefined}
                metadata={metadata}
                messageElementId={elementId}
                showFork={showForkCurrent}
                historyActionPending={ctx.historyActionPending}
                onFork={showForkCurrent ? () => ctx.onForkConversation!() : undefined}
            />
        </MessagePrimitive.Root>
    )
}
