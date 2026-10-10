import type { ExternalMessage } from '@hapi/protocol/messengers'
import { externalHttpUrl } from '@/chat/externalMessageLinks'
import { useTranslation } from '@/lib/use-translation'
import { ChatParticipantAvatar } from '@/components/ChatParticipantAvatar'

export function ExternalForwardHeader({ forward }: { forward: NonNullable<ExternalMessage['forward']> }) {
    const { t } = useTranslation()
    const href = externalHttpUrl(forward.sourceUrl)
    const sourceName = forward.sourceName || t('chats.forward.unknown')
    const name = forward.author ? `${sourceName} (${forward.author})` : sourceName
    return (
        <div data-external-forward className="mb-1 min-w-0 text-sm leading-[1.25] text-[var(--messenger-accent,var(--app-link))] [overflow-wrap:anywhere]">
            <div>{t('chats.forward.from')}</div>
            <div className="flex min-w-0 items-center gap-1">
                {forward.sourceAvatarDataUrl ? <ChatParticipantAvatar src={forward.sourceAvatarDataUrl} name={name} className="h-5 w-5 border-0" /> : null}
                {href ? (
                    <a href={href} target="_blank" rel="noopener noreferrer" className="min-w-0 font-medium hover:underline underline-offset-2">{name}</a>
                ) : <div className="min-w-0 font-medium">{name}</div>}
            </div>
        </div>
    )
}
