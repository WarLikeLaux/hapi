import { Fragment } from 'react'
import { parseExternalMessageSegments } from '@/chat/externalMessageLinks'

export function ExternalMessageText(props: { text: string }) {
    const segments = parseExternalMessageSegments(props.text)
    return (
        <div className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
            {segments.map((segment, index) => segment.type === 'text' ? (
                <Fragment key={index}>{segment.text}</Fragment>
            ) : (
                // Messenger texts render links as plain anchors: the provider
                // (Telegram) never expands a preview for them, and the fork's
                // default opens external http(s) links in a new tab.
                <a
                    key={index}
                    href={segment.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-[var(--app-link)] underline decoration-[color:var(--app-link-muted)] underline-offset-3"
                >
                    {segment.text}
                </a>
            ))}
        </div>
    )
}
