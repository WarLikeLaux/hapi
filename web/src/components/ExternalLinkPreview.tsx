import { useEffect, useRef, useState } from 'react'
import type { ExternalMessage } from '@hapi/protocol/messengers'
import { externalHttpUrl } from '@/chat/externalMessageLinks'
import { useAppContext } from '@/lib/app-context'

export function ExternalLinkPreview({ message }: { message: ExternalMessage }) {
    const { api } = useAppContext()
    const preview = message.linkPreview
    const href = externalHttpUrl(preview?.url)
    const mediaIndex = preview?.mediaIndex
    const media = mediaIndex !== undefined ? message.media?.[mediaIndex] : undefined
    const ref = useRef<HTMLAnchorElement>(null)
    const [imageUrl, setImageUrl] = useState<string | null>(null)
    const [imageFailed, setImageFailed] = useState(false)

    useEffect(() => {
        setImageUrl(null)
        setImageFailed(false)
        if (!api || !href || mediaIndex === undefined || media?.kind !== 'image') return
        let cancelled = false
        let objectUrl: string | undefined
        const load = async () => {
            try {
                const blob = await api.getExternalMediaBlob(message.conversationId, message.providerMessageId, mediaIndex)
                if (cancelled) return
                objectUrl = URL.createObjectURL(blob)
                setImageUrl(objectUrl)
                setImageFailed(false)
            } catch {
                // The text card stays usable even if Telegram cannot supply its image.
            }
        }
        const element = ref.current
        let observer: IntersectionObserver | undefined
        if (element && typeof IntersectionObserver !== 'undefined') {
            observer = new IntersectionObserver((entries) => {
                if (!entries.some((entry) => entry.isIntersecting)) return
                observer?.disconnect()
                void load()
            }, { rootMargin: '500px 0px' })
            observer.observe(element)
        } else {
            void load()
        }
        return () => {
            cancelled = true
            observer?.disconnect()
            if (objectUrl) URL.revokeObjectURL(objectUrl)
        }
    }, [api, href, media?.kind, mediaIndex, message.conversationId, message.providerMessageId])

    if (!preview || !href) return null
    const site = preview.siteName || new URL(href).hostname
    const src = imageUrl ?? media?.thumbnailDataUrl
    return (
        <a
            ref={ref}
            data-external-link-preview
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 flex w-[min(24rem,100%)] max-w-full flex-col gap-1 overflow-hidden rounded-xl bg-black/5 p-2.5 text-[var(--app-fg)] transition-colors hover:bg-black/10 dark:bg-white/10 dark:hover:bg-white/15 [overflow-wrap:anywhere]"
        >
            <span className="text-xs font-semibold text-[var(--app-link)]">{site}</span>
            {preview.title ? <span className="text-sm font-semibold leading-snug">{preview.title}</span> : null}
            {preview.description ? <span className="line-clamp-4 text-sm leading-snug">{preview.description}</span> : null}
            {src && !imageFailed ? (
                <img src={src} alt="" referrerPolicy="no-referrer" onError={() => setImageFailed(true)} className="mt-1 block max-h-64 w-full rounded-lg object-cover" />
            ) : null}
        </a>
    )
}
