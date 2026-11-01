import { MessageImageGallery } from '@/components/ImagePreview'
import { Children, useEffect, useMemo, useState, type PropsWithChildren } from 'react'
import {
    MessagePrimitive, useAuiState, getExternalStoreMessages,
    type DataMessagePartProps, type TextMessagePart, type TextMessagePartProps, type ThreadMessageLike, type ThreadAssistantMessagePart
} from '@assistant-ui/react'
import { Reasoning, ReasoningGroup } from '@/components/assistant-ui/reasoning'
import { HappyToolMessage, ImageSequenceContext } from '@/components/AssistantChat/messages/ToolMessage'
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
import { hasRenderableResponsePart, isAgentImageInspection, partitionCompletedResponseParts, shouldCompactResponse } from './responseDisplay'
import { ResponseChanges } from './ResponseChanges'
import { imageDisplayCaption, isInlineImageMimeType } from '@/lib/generatedInlineMedia'
import type { GeneratedImageBlock } from '@/chat/types'
import { ArrowLeftIcon, ArrowRightIcon } from '@/components/icons'

const TOOL_COMPONENTS = {
    Fallback: HappyToolMessage
} as const

// A joined response takes its card ID from its first record, which can change
// during history backfill. Each prose part retains its original record ID.
function AnchoredResponseText(props: TextMessagePartProps) {
    const sourceId = useAuiState(({ part }) => part.type === 'text'
        ? getExternalStoreMessages<ThreadMessageLike>(part)[0]?.id
        : undefined)
    return (
        <div id={sourceId ? `hapi-response-part-${sourceId}` : undefined} data-hapi-scroll-anchor="true">
            <NotifySummaryText {...props} />
        </div>
    )
}

function ImageSequence({ children, indices }: PropsWithChildren<{ indices: number[] }>) {
    const { t } = useTranslation()
    const parts = Children.toArray(children)
    const [selected, setSelected] = useState(0)
    const index = Math.min(selected, parts.length - 1)
    const caption = useAuiState((s) => {
        const part = s.message.content[indices[index]]
        const artifact = part?.type === 'tool-call' ? part.artifact as GeneratedImageBlock | undefined : undefined
        return artifact?.kind === 'generated-image' ? imageDisplayCaption(artifact.fileName) : ''
    })
    if (parts.length === 1) return <MessageImageGallery>{children}</MessageImageGallery>
    return <MessageImageGallery>
        <div role="region" tabIndex={0} aria-label={t('media.displayed.images', { count: String(parts.length) })} onKeyDown={(event) => {
            if (event.key === 'ArrowLeft' && index > 0) { event.preventDefault(); setSelected(index - 1) }
            if (event.key === 'ArrowRight' && index < parts.length - 1) { event.preventDefault(); setSelected(index + 1) }
        }} className="w-full max-w-2xl overflow-hidden rounded-2xl bg-[var(--app-tool-card-bg)] px-1 py-4 focus-visible:outline-2 focus-visible:outline-[var(--app-link)]">
            <div className="relative flex h-56 items-center justify-center sm:h-80">
                <ImageSequenceContext.Provider value={true}>
                    {parts.map((part, partIndex) => {
                        const distance = partIndex - index
                        return <div key={partIndex} hidden={Math.abs(distance) > 1} aria-hidden={distance !== 0} inert={distance !== 0} className={cn('absolute flex max-h-full items-center justify-center overflow-hidden rounded-xl [&>div]:w-full', distance === 0 ? 'z-10 w-[46%] shadow-lg' : distance < 0 ? 'left-[8%] w-[18%] opacity-45' : 'right-[8%] w-[18%] opacity-45')}>{part}</div>
                    })}
                </ImageSequenceContext.Provider>
                <button type="button" aria-label={t('media.displayed.previousImage')} disabled={index === 0} onClick={() => setSelected(index - 1)} className="absolute left-1 top-1/2 z-20 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-[var(--app-fg)] text-[var(--app-bg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--app-link)] disabled:opacity-30"><ArrowLeftIcon className="h-5 w-5" /></button>
                <button type="button" aria-label={t('media.displayed.nextImage')} disabled={index === parts.length - 1} onClick={() => setSelected(index + 1)} className="absolute right-1 top-1/2 z-20 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-[var(--app-fg)] text-[var(--app-bg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--app-link)] disabled:opacity-30"><ArrowRightIcon className="h-5 w-5" /></button>
            </div>
            <div className="mt-3 break-words px-4 text-center text-sm font-medium text-[var(--app-fg)]" aria-live="polite" aria-atomic="true">{caption}</div>
            <div className="mt-3 flex flex-wrap items-center justify-center gap-1" aria-label={`${index + 1} / ${parts.length}`}>
                {parts.map((_, dotIndex) => <button key={dotIndex} type="button" aria-label={t('media.displayed.goToImage', { number: String(dotIndex + 1) })} aria-current={dotIndex === index ? 'true' : undefined} onClick={() => setSelected(dotIndex)} className="flex h-8 w-8 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-[var(--app-link)]"><span className={cn('h-2 w-2 rounded-full', dotIndex === index ? 'bg-[var(--app-fg)]' : 'bg-[var(--app-hint)] opacity-40')} /></button>)}
            </div>
        </div>
    </MessageImageGallery>
}

function ResponsePartsGroup({ groupKey, indices, children }: PropsWithChildren<{ groupKey: string | undefined; indices: number[] }>) {
    if (groupKey === 'image-sequence') return <ImageSequence indices={indices}>{children}</ImageSequence>
    return groupKey === 'response-text'
        ? <div className="happy-assistant-bubble flex min-w-0 max-w-full flex-col gap-2">{children}</div>
        : <>{children}</>
}

function ResponseRecap({ data }: DataMessagePartProps<{ text: string }>) {
    return (
        <div data-hapi-response-recap="true" className="mt-3 min-w-0">
            <p className="min-w-0 whitespace-pre-wrap break-words text-base leading-relaxed text-[var(--app-fg)]">
                <span className="font-medium text-[var(--app-hint)]">recap:</span>{' '}{data.text}
            </p>
        </div>
    )
}

const RECAP_COMPONENTS = { by_name: { recap: ResponseRecap } } as const


const MESSAGE_PART_COMPONENTS = {
    Text: AnchoredResponseText,
    Reasoning: Reasoning,
    ReasoningGroup: ReasoningGroup,
    tools: TOOL_COMPONENTS,
    data: RECAP_COMPONENTS,
    Group: ResponsePartsGroup,
} as const

function DetailPartsGroup({ children }: PropsWithChildren) {
    return <div className="flex min-w-0 flex-col gap-3">{children}</div>
}

const DETAIL_PART_COMPONENTS = {
    Text: NotifySummaryText,
    Reasoning,
    tools: TOOL_COMPONENTS,
    data: RECAP_COMPONENTS,
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
        () => () => {
            const visibleIndices = compactParts?.visibleIndices ?? messageParts.flatMap((part, index) => isAgentImageInspection(part) ? [] : [index])
            const groups: { groupKey: string | undefined; indices: number[] }[] = []
            for (const index of visibleIndices) {
                const part = messageParts[index]
                const artifact = part.type === 'tool-call' ? part.artifact as GeneratedImageBlock | undefined : undefined
                const image = part.type === 'tool-call' && part.toolName === 'GeneratedImage'
                    && artifact?.kind === 'generated-image' && isInlineImageMimeType(artifact.mimeType)
                const key = image ? 'image-sequence' : part.type === 'text' ? 'response-text' : undefined
                const previous = groups.at(-1)
                if (key && previous?.groupKey === key) {
                    previous.indices.push(index)
                } else groups.push({ groupKey: key, indices: [index] })
            }
            return groups
        },
        [compactParts, messageParts]
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
    // Copy must match what the bubble shows: when the response is compacted,
    // public prose (+ recap/media) stays visible, internal work lives in the
    // Work dialog and must not leak into the clipboard.
    const visibleCopyText = useMemo(() => {
        if (!compactParts) return copyText
        const visible = compactParts.visibleIndices
            .map((index) => messageParts[index])
            .filter((part) => part !== undefined)
        return getAssistantCopyText(visible, {
            stripNotifySummary: !showSessionSummaryInChat
        })
    }, [compactParts, copyText, messageParts, showSessionSummaryInChat])

    const durationMs = useAuiState(({ message }) => (message.metadata.custom as Partial<HappyChatMessageMetadata> | undefined)?.durationMs)
    const usage = useAuiState(({ message }) => (message.metadata.custom as Partial<HappyChatMessageMetadata> | undefined)?.usage)
    const messageModel = useAuiState(({ message }) => (message.metadata.custom as Partial<HappyChatMessageMetadata> | undefined)?.model)
    const turnCount = useAuiState(({ message }) => (message.metadata.custom as Partial<HappyChatMessageMetadata> | undefined)?.turnCount)
    const roundSummary = useAuiState(({ message }) => (message.metadata.custom as Partial<HappyChatMessageMetadata> | undefined)?.roundSummary)
    const workspaceChanges = roundSummary?.workspaceChanges
    const showMessageActions = isCliOutput
        || Boolean(codexReview)
        || Boolean(workspaceChanges)
        || hasRenderableResponsePart(messageParts)

    const metadata = { durationMs, usage, model: messageModel ?? null, turnCount, roundSummary }

    const history = ctx.metadata?.capabilities?.conversationHistory
    const showForkCurrent = Boolean(
        (history?.forkCurrent || ctx.allowInactiveFork)
        && ctx.isLatestCompletedBoundary?.(messageId)
        && (!ctx.disabled || ctx.allowInactiveFork === true)
        && ctx.onForkConversation
    )

    const rootClass = toolOnly
        ? 'py-1 min-w-0 max-w-full overflow-x-hidden'
        : 'px-1 min-w-0 max-w-full overflow-x-hidden'

    useEffect(() => {
        if (!compactParts) setWorkOpen(false)
    }, [compactParts])

    return (
        <MessageImageGallery>
        <MessagePrimitive.Root
            id={elementId}
            data-hapi-message-role="assistant"
            className={`happy-message ${rootClass} scroll-mt-4`}
        >
            {isCliOutput
                ? <CliOutputBlock text={cliText} />
                : codexReview
                    ? <CodexReviewCard review={codexReview} />
                    : (
                        <>
                            <MessagePrimitive.Unstable_PartsGrouped
                                groupingFunction={visiblePartsGrouping}
                                components={MESSAGE_PART_COMPONENTS}
                            />
                        </>
                    )}
            {compactParts || workspaceChanges ? (
                <>
                    <div className="happy-response-work mt-1 flex flex-wrap items-center gap-1" data-hapi-share-exclude="true">
                        {compactParts ? (
                            <button
                                type="button"
                                onClick={() => setWorkOpen(true)}
                                aria-haspopup="dialog"
                                className={cn(
                                    'inline-flex h-6 items-center gap-1.5 rounded-lg px-2 text-xs font-medium',
                                    'text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)]',
                                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)]'
                                )}
                            >
                                <WorkIcon className="h-4 w-4" />
                                <span>{t('session.responseWork.open')}</span>
                                <span className="tabular-nums opacity-70">
                                    ({compactParts.detailIndices.length})
                                </span>
                            </button>
                        ) : null}
                        {workspaceChanges ? <ResponseChanges changes={workspaceChanges} api={ctx.api} sessionId={ctx.sessionId} /> : null}
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
            {showMessageActions ? (
                <MessageActions
                    align="start"
                    copyText={visibleCopyText || undefined}
                    metadata={metadata}
                    messageElementId={elementId}
                    showFork={showForkCurrent}
                    historyActionPending={ctx.historyActionPending}
                    onFork={showForkCurrent ? () => ctx.onForkConversation!() : undefined}
                />
            ) : null}
        </MessagePrimitive.Root>
        </MessageImageGallery>
    )
}
