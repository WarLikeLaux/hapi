import type { ExternalMessage } from '@hapi/protocol/messengers'
import { externalHttpUrl } from '@/chat/externalMessageLinks'
import { useTranslation } from '@/lib/use-translation'

export function ExternalForwardHeader({ forward }: { forward: NonNullable<ExternalMessage['forward']> }) {
    const { t } = useTranslation()
    const href = externalHttpUrl(forward.sourceUrl)
    const name = forward.sourceName || t('chats.forward.unknown')
    return (
        <div data-external-forward className="mb-2 flex min-w-0 items-start gap-2 text-[var(--app-link)]">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0">
                <path d="m11 3 6 5-6 5V9C6 9 3 11 3 16V9c0-4 3-5 8-5V3Z" strokeLinejoin="round" />
            </svg>
            <div className="min-w-0 text-xs leading-snug [overflow-wrap:anywhere]">
                <div>{t('chats.forward.from')}</div>
                {href ? (
                    <a href={href} target="_blank" rel="noopener noreferrer" className="font-semibold hover:underline underline-offset-2">{name}</a>
                ) : <div className="font-semibold">{name}</div>}
                {forward.author ? <div className="mt-0.5 text-[var(--app-fg)]">{forward.author}</div> : null}
            </div>
        </div>
    )
}
