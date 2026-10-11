import { useState } from 'react'
import type { MessageStatus } from '@/types/api'
import { LazyRainbowText } from '@/components/LazyRainbowText'
import { SparklesIcon } from '@/components/ToolCard/icons'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/lib/use-translation'

const LEADING_DIRECTIVE_REGEX = /^([$\/][a-z0-9][\w-]*)(?=\s|$)/i

export function getUserBubbleClassName(status?: MessageStatus) {
    return cn(
        'happy-user-bubble happy-chat-text ml-auto w-fit min-w-0 max-w-[92%] rounded-2xl bg-[var(--app-chat-user-surface-bg)] px-4 py-2.5 text-[var(--app-chat-user-fg)] shadow-none',
        status === 'queued' && 'opacity-60'
    )
}

export function shouldShowMessageStatus(status?: MessageStatus): boolean {
    return status === 'queued' || status === 'sending' || status === 'failed'
}

export function extractLeadingDirectives(text: string): { directives: string[]; body: string } {
    let rest = text.trimStart()
    const directives: string[] = []

    while (rest.length > 0) {
        const match = rest.match(LEADING_DIRECTIVE_REGEX)
        if (!match) break

        directives.push(match[1])
        rest = rest.slice(match[0].length).trimStart()
    }

    return {
        directives,
        body: rest,
    }
}

export function formatDirectiveLabel(value: string): string {
    return value
        .replace(/^[$/]/, '')
        .replace(/[_-]+/g, ' ')
        .trim()
}

export function DirectiveChip(props: { value: string }) {
    const label = formatDirectiveLabel(props.value)

    return (
        <span
            className={cn(
                'inline-flex items-center justify-center gap-[0.2rem] whitespace-nowrap rounded-full border-0 bg-[var(--app-chat-user-chip-bg)] px-2 py-px align-middle text-[length:var(--app-chat-font-size)] font-normal leading-[1.4] text-[var(--app-chat-user-chip-fg)] shadow-none'
            )}
            title={props.value}
            aria-label={props.value}
        >
            <SparklesIcon className="h-[0.92em] w-[0.92em] shrink-0 [stroke-width:1.6]" />
            <span>{label}</span>
        </span>
    )
}

const COLLAPSE_CHAR_LIMIT = 600
const COLLAPSE_LINE_LIMIT = 10
const COLLAPSED_MAX_HEIGHT = '12rem'

function isCollapsibleBody(body: string): boolean {
    if (body.length > COLLAPSE_CHAR_LIMIT) return true
    return body.split(/\r\n|\r|\n/).length > COLLAPSE_LINE_LIMIT
}

function CollapsibleBody({ body }: { body: string }) {
    const { t } = useTranslation()
    const [expanded, setExpanded] = useState(false)
    return (
        <div className="min-w-0">
            <div
                className={cn('relative min-w-0 overflow-hidden', !expanded && 'max-h-48')}
                style={expanded ? undefined : { maxHeight: COLLAPSED_MAX_HEIGHT }}
            >
                <LazyRainbowText text={body} preserveSingleLineBreaks />
                {!expanded ? (
                    <div
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-[var(--app-chat-user-surface-bg)] to-transparent"
                    />
                ) : null}
            </div>
            <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                aria-expanded={expanded}
                className="mt-1 inline-flex items-center gap-1 rounded-md text-xs font-medium text-[var(--app-chat-user-fg)] opacity-70 underline-offset-2 hover:opacity-100 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)]"
            >
                {expanded ? t('chat.message.showLess') : t('chat.message.showMore')}
            </button>
        </div>
    )
}

export function UserBubbleContent(props: { text: string }) {
    const { directives, body } = extractLeadingDirectives(props.text)
    const hasBody = body.trim().length > 0
    const shouldRenderInline = directives.length > 0 && hasBody && !/[\r\n]/.test(body) && !isCollapsibleBody(body)

    if (shouldRenderInline) {
        return (
            <div className="happy-chat-text min-w-0">
                <div className="inline-flex min-w-0 flex-wrap items-center gap-x-1 gap-y-1.5 align-top">
                    {directives.map((directive) => <DirectiveChip key={directive} value={directive} />)}
                    <LazyRainbowText text={body} inline preserveSingleLineBreaks />
                </div>
            </div>
        )
    }

    return (
        <div className="flex min-w-0 flex-col gap-2">
            {directives.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                    {directives.map((directive) => <DirectiveChip key={directive} value={directive} />)}
                </div>
            ) : null}
            {hasBody ? (isCollapsibleBody(body) ? <CollapsibleBody body={body} /> : <LazyRainbowText text={body} preserveSingleLineBreaks />) : null}
        </div>
    )
}
