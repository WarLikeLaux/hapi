import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { ToolCallMessagePartProps } from '@assistant-ui/react'
import type { ChatBlock } from '@/chat/types'
import type { GeneratedImageBlock, ToolCallBlock } from '@/chat/types'
import type { ToolGroupBlock } from '@/chat/toolGroups'
import { isObject, safeStringify } from '@hapi/protocol'
import { isSubagentToolName } from '@/chat/subagentTool'
import { ToolGroupCard } from '@/components/ToolCard/ToolGroupCard'
import { getEventPresentation } from '@/chat/presentation'
import { CodeBlock } from '@/components/CodeBlock'
import { MarkdownRenderer } from '@/components/MarkdownRenderer'
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard'
import { CheckIcon, CopyIcon, DownloadIcon } from '@/components/icons'
import { MessageStatusIndicator } from '@/components/AssistantChat/messages/MessageStatusIndicator'
import { ToolCard } from '@/components/ToolCard/ToolCard'
import { useHappyChatContext } from '@/components/AssistantChat/context'
import { CliOutputBlock } from '@/components/CliOutputBlock'
import { UserBubbleContent, getUserBubbleClassName, shouldShowMessageStatus } from '@/components/AssistantChat/messages/user-bubble'
import { ImagePreview } from '@/components/ImagePreview'
import { FileIcon } from '@/components/FileIcon'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useTranslation } from '@/lib/use-translation'
import { inlineMediaLabelKey, isInlineAudioMimeType, isInlineImageMimeType, isInlineVideoMimeType } from '@/lib/generatedInlineMedia'

function isToolCallBlock(value: unknown): value is ToolCallBlock {
    if (!isObject(value)) return false
    if (value.kind !== 'tool-call') return false
    if (typeof value.id !== 'string') return false
    if (value.localId !== null && typeof value.localId !== 'string') return false
    if (typeof value.createdAt !== 'number') return false
    if (!Array.isArray(value.children)) return false
    if (!isObject(value.tool)) return false
    if (typeof value.tool.name !== 'string') return false
    if (!('input' in value.tool)) return false
    if (value.tool.description !== null && typeof value.tool.description !== 'string') return false
    if (value.tool.state !== 'pending' && value.tool.state !== 'running' && value.tool.state !== 'completed' && value.tool.state !== 'error') return false
    return true
}

function isToolGroupBlock(value: unknown): value is ToolGroupBlock {
    if (!isObject(value)) return false
    if (value.kind !== 'tool-group') return false
    if (typeof value.id !== 'string') return false
    if (!Array.isArray(value.tools)) return false
    return true
}

function isGeneratedImageBlock(value: unknown): value is GeneratedImageBlock {
    if (!isObject(value)) return false
    if (value.kind !== 'generated-image') return false
    if (typeof value.id !== 'string') return false
    if (typeof value.imageId !== 'string') return false
    if (typeof value.fileName !== 'string') return false
    if (value.mimeType !== null && typeof value.mimeType !== 'string') return false
    return true
}

const MIN_INLINE_IMAGE_DIMENSION = 64
/** Markdown up to this size renders directly in the chat card instead of behind a preview button. */
const INLINE_MARKDOWN_MAX_CHARS = 10_000

export function isHtmlFileName(fileName: string): boolean {
    return /\.html?$/i.test(fileName)
}

export function isMarkdownFileName(fileName: string): boolean {
    return /\.(?:md|markdown)$/i.test(fileName)
}

function escapeHtmlAttribute(value: string): string {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('"', '&quot;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
}

function readBlobAsText(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
        reader.onerror = () => reject(reader.error ?? new Error('Failed to read HTML file'))
        reader.readAsText(blob)
    })
}

/** Keep displayed HTML interactive without giving it HAPI's authenticated origin. */
export async function createSandboxedHtmlPreviewBlob(source: Blob, fileName: string): Promise<Blob> {
    const sourceHtml = await readBlobAsText(source)
    const title = escapeHtmlAttribute(fileName)
    const srcdoc = escapeHtmlAttribute(sourceHtml)
    return new Blob([
        '<!doctype html><html><head>',
        '<meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width,initial-scale=1">',
        `<title>${title}</title>`,
        '<style>html,body,iframe{box-sizing:border-box;width:100%;height:100%;margin:0;border:0}body{overflow:hidden}</style>',
        '</head><body>',
        `<iframe title="${title}" sandbox="allow-scripts allow-forms allow-modals allow-downloads" referrerpolicy="no-referrer" srcdoc="${srcdoc}"></iframe>`,
        '</body></html>',
    ], { type: 'text/html' })
}

/** Scale tiny icons up for readability without exploding skinny/tall images. */
export function computeTinyImageScale(width: number, height: number): number {
    const maxDim = Math.max(width, height)
    if (width <= 0 || height <= 0 || maxDim >= MIN_INLINE_IMAGE_DIMENSION) {
        return 1
    }
    return Math.min(MIN_INLINE_IMAGE_DIMENSION / maxDim, 16)
}

/** Exported for generated-media fetch and renderer tests. */
export function GeneratedImageCard(props: { block: GeneratedImageBlock }) {
    const ctx = useHappyChatContext()
    const { t } = useTranslation()
    const [objectUrl, setObjectUrl] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [imageStyle, setImageStyle] = useState<CSSProperties | undefined>(undefined)
    const [loadMedia, setLoadMedia] = useState(false)
    const [markdownContent, setMarkdownContent] = useState<string | null>(null)
    const [markdownPreviewOpen, setMarkdownPreviewOpen] = useState(false)
    const { copied, copy } = useCopyToClipboard()
    const objectUrlRef = useRef<string | null>(null)
    const isVideo = isInlineVideoMimeType(props.block.mimeType)
    const isAudio = isInlineAudioMimeType(props.block.mimeType)
    const isImage = isInlineImageMimeType(props.block.mimeType)
    const isFile = !isVideo && !isAudio && !isImage
    const isHtml = isFile && isHtmlFileName(props.block.fileName)
    const isMarkdown = isFile && isMarkdownFileName(props.block.fileName)
    const mediaLabel = t(inlineMediaLabelKey(props.block.mimeType))
    const mediaHeader = t('media.displayed.header', { label: mediaLabel, fileName: props.block.fileName })
    // Markdown is small text and renders inline, so it fetches eagerly; the remaining
    // non-image media can be tens of MB and wait for explicit user intent.
    const shouldFetch = isImage || isHtml || isMarkdown || loadMedia
    const inlineMarkdown = !error && markdownContent !== null && markdownContent.length <= INLINE_MARKDOWN_MAX_CHARS
        ? markdownContent
        : null

    useEffect(() => {
        return () => {
            if (objectUrlRef.current) {
                URL.revokeObjectURL(objectUrlRef.current)
                objectUrlRef.current = null
            }
        }
    }, [])

    useEffect(() => {
        if (!shouldFetch) {
            return
        }

        let disposed = false

        if (objectUrlRef.current) {
            URL.revokeObjectURL(objectUrlRef.current)
            objectUrlRef.current = null
        }
        setObjectUrl(null)
        setMarkdownContent(null)
        setImageStyle(undefined)
        setError(null)

        void ctx.api.getGeneratedImageBlob(ctx.sessionId, props.block.imageId)
            .then(async (blob) => {
                const nextMarkdownContent = isMarkdown ? await readBlobAsText(blob) : null
                const displayBlob = isHtml
                    ? await createSandboxedHtmlPreviewBlob(blob, props.block.fileName)
                    : blob
                const nextObjectUrl = URL.createObjectURL(displayBlob)
                if (disposed) {
                    URL.revokeObjectURL(nextObjectUrl)
                    return
                }
                if (objectUrlRef.current) {
                    URL.revokeObjectURL(objectUrlRef.current)
                }
                objectUrlRef.current = nextObjectUrl
                setObjectUrl(nextObjectUrl)
                setMarkdownContent(nextMarkdownContent)
                if (isImage) {
                    setImageStyle(undefined)
                    const probe = new Image()
                    probe.onload = () => {
                        if (disposed) return
                        const scale = computeTinyImageScale(probe.naturalWidth, probe.naturalHeight)
                        setImageStyle(scale === 1 ? undefined : { transform: `scale(${scale})` })
                    }
                    probe.src = nextObjectUrl
                }
            })
            .catch((err: unknown) => {
                if (disposed) return
                setError(err instanceof Error ? err.message : 'Failed to load inline media')
            })

        return () => {
            disposed = true
        }
    }, [ctx.api, ctx.sessionId, props.block.fileName, props.block.imageId, isHtml, isImage, isMarkdown, shouldFetch])

    const openMarkdownPreview = () => {
        setMarkdownPreviewOpen(true)
    }

    return (
        <div className="max-w-[92%] rounded-2xl border border-[var(--app-border)] bg-[var(--app-tool-card-bg)] p-3">
            <div className="mb-2 flex min-w-0 items-center gap-2 text-xs font-medium text-[var(--app-hint)]">
                <span className="min-w-0 truncate">{mediaHeader}</span>
                {inlineMarkdown !== null ? (
                    <span className="ml-auto flex shrink-0 items-center gap-0.5">
                        <button
                            type="button"
                            data-hapi-share-export-exclude="true"
                            onClick={() => void copy(inlineMarkdown)}
                            title={copied ? t('media.displayed.copied') : t('media.displayed.copy')}
                            aria-label={copied ? t('media.displayed.copied') : t('media.displayed.copy')}
                            className="flex shrink-0 items-center rounded-md p-1 text-[var(--app-hint)] transition-colors hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)]"
                        >
                            {copied ? <CheckIcon className="h-3.5 w-3.5" /> : <CopyIcon className="h-3.5 w-3.5" />}
                        </button>
                        {objectUrl ? (
                            <a
                                href={objectUrl}
                                download={props.block.fileName}
                                data-hapi-share-export-exclude="true"
                                title={t('media.displayed.download')}
                                aria-label={t('media.displayed.download')}
                                className="flex shrink-0 items-center rounded-md p-1 text-[var(--app-hint)] transition-colors hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)]"
                            >
                                <DownloadIcon className="h-3.5 w-3.5" />
                            </a>
                        ) : null}
                    </span>
                ) : null}
            </div>
            {isMarkdown ? (
                error ? (
                    <div className="text-sm text-[var(--app-hint)]">
                        {t('media.displayed.unavailable', { label: mediaLabel, error })}
                    </div>
                ) : inlineMarkdown !== null ? (
                    <div className="overflow-hidden rounded-xl border border-[var(--app-border)] bg-[var(--app-subtle-bg)]">
                        <div
                            data-hapi-nested-scroll="true"
                            // No overscroll containment: native scroll chaining must
                            // pass to the outer chat viewport (see reasoning.tsx).
                            className="max-h-[min(60rem,80dvh)] overflow-y-auto px-4 py-3"
                        >
                            {inlineMarkdown.length === 0 ? (
                                <div className="text-sm text-[var(--app-hint)]">{t('file.page.empty')}</div>
                            ) : (
                                <MarkdownRenderer content={inlineMarkdown} standalone />
                            )}
                        </div>
                    </div>
                ) : markdownContent === null ? (
                    <div className="h-24 w-72 max-w-full animate-pulse rounded-xl bg-[var(--app-subtle-bg)]" />
                ) : (
                    <button
                        type="button"
                        onClick={openMarkdownPreview}
                        className="flex w-full items-center gap-3 rounded-xl border border-[var(--app-border)] bg-[var(--app-subtle-bg)] px-4 py-3 text-left text-sm font-medium text-[var(--app-fg)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)]"
                    >
                        <FileIcon fileName={props.block.fileName} size={24} />
                        <span className="min-w-0 truncate">{t('media.displayed.previewNamed', { fileName: props.block.fileName })}</span>
                    </button>
                )
            ) : objectUrl ? (
                isVideo ? (
                    <div className="flex min-h-32 min-w-[12rem] items-center justify-center rounded-xl bg-[var(--app-subtle-bg)]">
                        <video
                            src={objectUrl}
                            controls
                            playsInline
                            className="max-h-[min(28rem,60vh)] max-w-full rounded-xl"
                        />
                    </div>
                ) : isAudio ? (
                    <audio
                        src={objectUrl}
                        controls
                        preload="metadata"
                        className="w-full min-w-[12rem]"
                    />
                ) : isFile ? (
                    <a
                        href={objectUrl}
                        download={isHtml ? undefined : props.block.fileName}
                        target={isHtml ? '_blank' : undefined}
                        rel={isHtml ? 'noopener noreferrer' : undefined}
                        className="flex items-center gap-3 rounded-xl border border-[var(--app-border)] bg-[var(--app-subtle-bg)] px-4 py-3 text-sm font-medium text-[var(--app-fg)]"
                    >
                        <FileIcon fileName={props.block.fileName} size={24} />
                        <span className="min-w-0 truncate">{isHtml ? 'Open' : 'Download'} {props.block.fileName}</span>
                    </a>
                ) : (
                    <div className="flex min-h-32 min-w-[12rem] items-center justify-center rounded-xl bg-[var(--app-subtle-bg)]">
                        <ImagePreview
                            src={objectUrl}
                            fileName={props.block.fileName}
                            label={props.block.fileName}
                            buttonClassName="block max-h-[min(28rem,60vh)] max-w-full cursor-zoom-in rounded-xl text-left"
                            imageClassName="max-h-[min(28rem,60vh)] max-w-full rounded-xl object-contain"
                            imageStyle={imageStyle}
                        />
                    </div>
                )
            ) : error ? (
                <div className="text-sm text-[var(--app-hint)]">
                    {t('media.displayed.unavailable', { label: mediaLabel, error })}
                </div>
            ) : !isImage && !loadMedia ? (
                <button
                    type="button"
                    onClick={() => setLoadMedia(true)}
                    className="flex h-48 w-72 max-w-full items-center justify-center rounded-xl border border-[var(--app-border)] bg-[var(--app-subtle-bg)] text-sm font-medium text-[var(--app-fg)]"
                >
                    {isVideo ? 'Load video' : isAudio ? 'Load audio' : 'Prepare download'}
                </button>
            ) : (
                <div className="h-48 w-72 max-w-full animate-pulse rounded-xl bg-[var(--app-subtle-bg)]" />
            )}
            {isMarkdown ? (
                <Dialog open={markdownPreviewOpen} onOpenChange={setMarkdownPreviewOpen}>
                    <DialogContent
                        aria-describedby={undefined}
                        className="flex max-h-[calc(100dvh-24px)] max-w-4xl flex-col overflow-hidden p-0 sm:max-h-[86vh]"
                    >
                        <DialogHeader className="shrink-0 border-b border-[var(--app-divider)] px-4 py-4 text-left">
                            <div className="flex min-w-0 items-center gap-1 pr-10">
                                <DialogTitle className="min-w-0 flex-1 truncate">
                                    {props.block.fileName}
                                </DialogTitle>
                                {markdownContent !== null ? (
                                    <button
                                        type="button"
                                        data-hapi-share-export-exclude="true"
                                        onClick={() => void copy(markdownContent)}
                                        className="shrink-0 rounded-lg px-3 py-2 text-sm font-medium text-[var(--app-link)] hover:bg-[var(--app-subtle-bg)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)]"
                                    >
                                        {copied ? t('media.displayed.copied') : t('media.displayed.copy')}
                                    </button>
                                ) : null}
                                {objectUrl ? (
                                    <a
                                        href={objectUrl}
                                        download={props.block.fileName}
                                        className="shrink-0 rounded-lg px-3 py-2 text-sm font-medium text-[var(--app-link)] hover:bg-[var(--app-subtle-bg)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)]"
                                    >
                                        {t('media.displayed.download')}
                                    </a>
                                ) : null}
                            </div>
                        </DialogHeader>
                        <div
                            data-hapi-nested-scroll="true"
                            className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 sm:px-6"
                        >
                            {error ? (
                                <div className="text-sm text-[var(--app-hint)]">
                                    {t('media.displayed.unavailable', { label: mediaLabel, error })}
                                </div>
                            ) : markdownContent === null ? (
                                <div className="h-48 animate-pulse rounded-xl bg-[var(--app-subtle-bg)]" />
                            ) : markdownContent.length === 0 ? (
                                <div className="text-sm text-[var(--app-hint)]">{t('file.page.empty')}</div>
                            ) : (
                                <MarkdownRenderer content={markdownContent} standalone />
                            )}
                        </div>
                    </DialogContent>
                </Dialog>
            ) : null}
        </div>
    )
}

function isPendingPermissionBlock(block: ChatBlock): boolean {
    return block.kind === 'tool-call' && block.tool.permission?.status === 'pending'
}

function splitTaskChildren(block: ToolCallBlock): { pending: ChatBlock[]; rest: ChatBlock[] } {
    const pending: ChatBlock[] = []
    const rest: ChatBlock[] = []

    for (const child of block.children) {
        if (isPendingPermissionBlock(child)) {
            pending.push(child)
        } else {
            rest.push(child)
        }
    }

    return { pending, rest }
}

function HappyNestedBlockList(props: {
    blocks: ChatBlock[]
}) {
    const ctx = useHappyChatContext()

    return (
        <div className="flex flex-col gap-3">
            {props.blocks.map((block) => {
                if (block.kind === 'user-text') {
                    const status = block.status
                    const canRetry = status === 'failed' && typeof block.localId === 'string' && Boolean(ctx.onRetryMessage)
                    const onRetry = canRetry ? () => ctx.onRetryMessage!(block.localId!) : undefined
                    const showStatus = shouldShowMessageStatus(status)

                    return (
                        <div key={`user:${block.id}`} className={getUserBubbleClassName(status)}>
                            <div className="flex items-start gap-2">
                                <div className="min-w-0 flex-1">
                                    <UserBubbleContent text={block.text} />
                                </div>
                                {showStatus ? (
                                    <div className="happy-message-actions-first-line shrink-0">
                                        <MessageStatusIndicator status={status} onRetry={onRetry} />
                                    </div>
                                ) : null}
                            </div>
                        </div>
                    )
                }

                if (block.kind === 'agent-text') {
                    return (
                        <div key={`agent:${block.id}`} className="px-1">
                            <MarkdownRenderer content={block.text} />
                        </div>
                    )
                }

                if (block.kind === 'cli-output') {
                    const alignClass = block.source === 'user' ? 'ml-auto w-full max-w-[92%]' : ''
                    return (
                        <div key={`cli:${block.id}`} className="px-1 min-w-0 max-w-full overflow-x-hidden">
                            <div className={alignClass}>
                                <CliOutputBlock text={block.text} />
                            </div>
                        </div>
                    )
                }

                if (block.kind === 'generated-image') {
                    return (
                        <div key={`generated-image:${block.id}`} className="px-1">
                            <GeneratedImageCard block={block} />
                        </div>
                    )
                }

                if (block.kind === 'agent-event') {
                    const presentation = getEventPresentation(block.event)
                    return (
                        <div key={`event:${block.id}`} className="py-1">
                            <div className="mx-auto w-fit max-w-[92%] px-2 text-center text-xs text-[var(--app-hint)] opacity-80">
                                <span className="inline-flex items-center gap-1">
                                    {presentation.icon ? <span aria-hidden="true">{presentation.icon}</span> : null}
                                    <span>{presentation.text}</span>
                                </span>
                            </div>
                        </div>
                    )
                }

                if (block.kind === 'tool-call') {
                    const isTask = isSubagentToolName(block.tool.name)
                    const hideChildren = block.tool.name === 'CodexAgent'
                    const taskChildren = isTask ? splitTaskChildren(block) : null

                    return (
                        <div key={`tool:${block.id}`} data-hapi-share-exclude="true" className="py-1">
                            <ToolCard
                                api={ctx.api}
                                sessionId={ctx.sessionId}
                                metadata={ctx.metadata}
                                terminalToolDisplayMode={ctx.terminalToolDisplayMode}
                                disabled={ctx.disabled}
                                onDone={ctx.onRefresh}
                                block={block}
                            />
                            {!hideChildren && block.children.length > 0 ? (
                                isTask ? (
                                    <>
                                        {taskChildren && taskChildren.pending.length > 0 ? (
                                            <div className="mt-2 pl-3">
                                                <HappyNestedBlockList blocks={taskChildren.pending} />
                                            </div>
                                        ) : null}
                                        {taskChildren && taskChildren.rest.length > 0 ? (
                                            <details className="mt-2">
                                                <summary className="cursor-pointer text-xs text-[var(--app-hint)]">
                                                    Task details ({taskChildren.rest.length})
                                                </summary>
                                                <div className="mt-2 pl-3">
                                                    <HappyNestedBlockList blocks={taskChildren.rest} />
                                                </div>
                                            </details>
                                        ) : null}
                                    </>
                                ) : (
                                    <div className="mt-2 pl-3">
                                        <HappyNestedBlockList blocks={block.children} />
                                    </div>
                                )
                            ) : null}
                        </div>
                    )
                }

                return null
            })}
        </div>
    )
}

export function HappyToolMessage(props: ToolCallMessagePartProps) {
    const ctx = useHappyChatContext()
    const artifact = props.artifact

    if (isToolGroupBlock(artifact)) {
        return (
            <div data-hapi-share-exclude="true" className="py-1 min-w-0 max-w-full overflow-x-hidden">
                <ToolGroupCard
                    block={artifact}
                    metadata={ctx.metadata}
                />
            </div>
        )
    }

    if (isGeneratedImageBlock(artifact)) {
        return (
            <div className="py-1 min-w-0 max-w-full overflow-x-hidden">
                <GeneratedImageCard block={artifact} />
            </div>
        )
    }

    if (!isToolCallBlock(artifact)) {
        const argsText = typeof props.argsText === 'string' ? props.argsText.trim() : ''
        const hasArgsText = argsText.length > 0
        const hasResult = props.result !== undefined
        const resultText = hasResult ? safeStringify(props.result) : ''

        return (
            <div data-hapi-share-exclude="true" className="py-1 min-w-0 max-w-full overflow-x-hidden">
                <div className="overflow-hidden rounded-[20px] bg-[var(--app-tool-card-bg)] p-3 shadow-none">
                    <div className="flex items-center gap-2 text-xs">
                        <div className="font-mono text-[var(--app-tool-card-accent)]">
                            Tool: {props.toolName}
                        </div>
                        {props.isError ? (
                            <span className="text-red-500">Error</span>
                        ) : null}
                        {props.status.type === 'running' && !hasResult ? (
                            <span className="text-[var(--app-hint)]">Running…</span>
                        ) : null}
                    </div>

                    {hasArgsText ? (
                        <div className="mt-2">
                            <CodeBlock code={argsText} language="json" title="Input" />
                        </div>
                    ) : null}

                    {hasResult ? (
                        <div className="mt-2">
                            <CodeBlock code={resultText} language={typeof props.result === 'string' ? 'text' : 'json'} title="Output" />
                        </div>
                    ) : null}
                </div>
            </div>
        )
    }

    const block = artifact
    const isTask = isSubagentToolName(block.tool.name)
    const hideChildren = block.tool.name === 'CodexAgent'
    const taskChildren = isTask ? splitTaskChildren(block) : null

    return (
        <div data-hapi-share-exclude="true" className="py-1 min-w-0 max-w-full overflow-x-hidden">
            <ToolCard
                api={ctx.api}
                sessionId={ctx.sessionId}
                metadata={ctx.metadata}
                terminalToolDisplayMode={ctx.terminalToolDisplayMode}
                disabled={ctx.disabled}
                onDone={ctx.onRefresh}
                block={block}
            />
            {!hideChildren && block.children.length > 0 ? (
                isTask ? (
                    <>
                        {taskChildren && taskChildren.pending.length > 0 ? (
                            <div className="mt-2 pl-3">
                                <HappyNestedBlockList blocks={taskChildren.pending} />
                            </div>
                        ) : null}
                        {taskChildren && taskChildren.rest.length > 0 ? (
                            <details className="mt-2">
                                <summary className="cursor-pointer text-xs text-[var(--app-hint)]">
                                    Task details ({taskChildren.rest.length})
                                </summary>
                                <div className="mt-2 pl-3">
                                    <HappyNestedBlockList blocks={taskChildren.rest} />
                                </div>
                            </details>
                        ) : null}
                    </>
                ) : (
                    <div className="mt-2 pl-3">
                        <HappyNestedBlockList blocks={block.children} />
                    </div>
                )
            ) : null}
        </div>
    )
}
