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
import { formatTokenDelta } from './SystemMessage'
import { formatMessageTimestamp, formatMessageTimestampTitle } from '@/chat/presentation'
import type { AgentEvent } from '@/chat/types'
import { ToolStatusIcon, ToolTimingSummary, toolStatusColorClass } from '@/components/ToolCard/ToolCard'
import { MarkdownRenderer } from '@/components/MarkdownRenderer'

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
        }} className="w-full overflow-hidden rounded-2xl bg-[var(--app-tool-card-bg)] px-1 py-4 focus-visible:outline-2 focus-visible:outline-[var(--app-link)]">
            <div className="relative flex min-h-32 items-center justify-center">
                <ImageSequenceContext.Provider value={true}>
                    {parts.map((part, partIndex) => {
                        const distance = partIndex - index
                        return <div key={partIndex} hidden={distance !== 0} aria-hidden={distance !== 0} inert={distance !== 0} className="w-full min-w-0 [&>div]:w-full">{part}</div>
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

type CompactionData = { event: AgentEvent; createdAt: number }

function CompactionGroup({ indices, children }: PropsWithChildren<{ indices: number[] }>) {
    const [open, setOpen] = useState(false)
    const content = useAuiState((s) => s.message.content)
    const parts = indices.map(index => content[index]).filter(part => part?.type === 'data' && part.name === 'compaction').map(part => (part as { data: CompactionData }).data)
    const starts = parts.filter(({ event }) => event.type === 'message' && event.message === '📦 Compaction started')
    const ends = parts.filter(({ event }) => event.type === 'compact-summary' || (event.type === 'message' && typeof event.message === 'string' && /^📦 (?:Compaction (?:completed|failed)|Compacted)/.test(event.message)))
    const startedAt = starts.length === 1 ? starts[0].createdAt : null
    const completedAt = ends.length === 1 ? ends[0].createdAt : null
    const durationMs = startedAt !== null && completedAt !== null && completedAt >= startedAt ? completedAt - startedAt : null
    return <section aria-label="Compaction" className="my-3 overflow-hidden rounded-[20px] bg-[var(--app-tool-group-bg)]">
        <div className="p-3 pb-2.5">
            <button type="button" aria-expanded={open} onClick={() => setOpen(value => !value)} className="w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)]">
                <div className="flex flex-col gap-1.5">
                    <div className="flex min-w-0 items-center gap-2">
                        <svg className={cn('h-4 w-4 shrink-0 text-[var(--app-tool-card-accent)] transition-transform duration-200', open && 'rotate-90')} viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                        <h3 className="min-w-0 truncate text-sm font-medium leading-tight text-[var(--app-fg)]">Compaction</h3>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-[var(--app-hint)]">
                        <ToolTimingSummary startedAt={startedAt} completedAt={completedAt} durationMs={durationMs} typography="group" />
                    </div>
                </div>
            </button>
        </div>
        {open ? <div className="flex flex-col gap-2 px-3 pb-3 pt-1">{children}</div> : null}
    </section>
}

function ResponsePartsGroup({ groupKey, indices, children }: PropsWithChildren<{ groupKey: string | undefined; indices: number[] }>) {
    if (groupKey === 'image-sequence') return <div className="happy-response-images"><ImageSequence indices={indices}>{children}</ImageSequence></div>
    if (groupKey === 'compaction') return <CompactionGroup indices={indices}>{children}</CompactionGroup>
    if (groupKey === 'reasoning') return <ReasoningGroup startIndex={indices[0]} endIndex={indices.at(-1)}>{children}</ReasoningGroup>
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

function ResponseCompaction({ data }: DataMessagePartProps<CompactionData>) {
    const [expanded, setExpanded] = useState(false)
    const date = new Date(data.createdAt)
    const event = data.event
    const summary = event.type === 'compact-summary' && typeof event.summary === 'string' ? event.summary : ''
    const label = event.type === 'compact-summary' ? 'Context compacted'
        : event.type === 'message' && typeof event.message === 'string' ? event.message.replace(/^📦\s*/, '') : 'Compaction'
    const failed = /^Compaction failed/.test(label)
    const state = failed ? 'error' : 'completed'
    const delta = formatTokenDelta(event)
    const canExpand = summary.trim().length > 0
    const Row = canExpand ? 'button' : 'div'
    return <div data-hapi-compaction={event.type === 'compact-summary' ? 'summary' : 'status'}>
        <Row type={canExpand ? 'button' : undefined} aria-expanded={canExpand ? expanded : undefined} onClick={canExpand ? () => setExpanded(value => !value) : undefined} className="flex w-full items-center gap-3 rounded-[16px] border border-[var(--app-border)] bg-[var(--app-bg)] px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)]">
            <span className={cn('shrink-0', toolStatusColorClass(state))}><ToolStatusIcon state={state} /></span>
            <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center text-[var(--app-tool-card-accent)]">
                <svg viewBox="0 0 16 16" fill="none" className="h-4 w-4" aria-hidden="true"><path d="M2.5 4.5 8 2l5.5 2.5v7L8 14l-5.5-2.5v-7ZM2.5 4.5 8 7l5.5-2.5M8 7v7" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" /></svg>
            </span>
            <span className="min-w-0 flex-1">
                <span className="block break-words text-sm font-medium text-[var(--app-fg)]">{label}</span>
                {delta ? <span className="block break-words text-xs text-[var(--app-tool-card-subtitle)]">{delta}</span> : null}
            </span>
            <time dateTime={date.toISOString()} title={formatMessageTimestampTitle(date)} className="shrink-0 font-mono text-xs text-[var(--app-hint)]">{formatMessageTimestamp(date)}</time>
        </Row>
        {canExpand && expanded ? <div className="max-h-96 overflow-y-auto px-3"><MarkdownRenderer standalone content={summary} /></div> : null}
    </div>
}

const RECAP_COMPONENTS = { by_name: { recap: ResponseRecap, compaction: ResponseCompaction } } as const


const MESSAGE_PART_COMPONENTS = {
    Text: AnchoredResponseText,
    Reasoning: Reasoning,
    ReasoningGroup: ReasoningGroup,
    tools: TOOL_COMPONENTS,
    data: RECAP_COMPONENTS,
    Group: ResponsePartsGroup,
} as const

function DetailPartsGroup({ groupKey, indices, children }: PropsWithChildren<{ groupKey: string | undefined; indices: number[] }>) {
    if (groupKey === 'compaction') return <CompactionGroup indices={indices}>{children}</CompactionGroup>
    if (groupKey === 'reasoning') return <ReasoningGroup startIndex={indices[0]} endIndex={indices.at(-1)}>{children}</ReasoningGroup>
    return <div className="my-3 flex min-w-0 flex-col gap-3">{children}</div>
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
                const key = image ? 'image-sequence' : part.type === 'text' ? 'response-text' : part.type === 'reasoning' ? 'reasoning'
                    : part.type === 'data' && part.name === 'compaction' ? 'compaction' : undefined
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
        () => () => {
            const groups: { groupKey: string; indices: number[] }[] = []
            for (const index of compactParts?.detailIndices ?? []) {
                const part = messageParts[index]
                const groupKey = part.type === 'data' && part.name === 'compaction' ? 'compaction' : part.type === 'reasoning' ? 'reasoning' : 'response-work'
                const previous = groups.at(-1)
                if (previous?.groupKey === groupKey) previous.indices.push(index)
                else groups.push({ groupKey, indices: [index] })
            }
            return groups
        },
        [compactParts, messageParts]
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
