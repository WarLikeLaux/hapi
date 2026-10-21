import { useEffect, useState } from 'react'
import { ImagePreview } from '@/components/ImagePreview'
import { CloseIcon } from '@/components/icons'

export function ChatsComposerAttachment(props: { file: File; onRemove: () => void }) {
    const [previewUrl, setPreviewUrl] = useState<string | null>(null)
    useEffect(() => {
        if (!props.file.type.startsWith('image/')) {
            setPreviewUrl(null)
            return
        }
        const url = URL.createObjectURL(props.file)
        setPreviewUrl(url)
        return () => URL.revokeObjectURL(url)
    }, [props.file])

    if (props.file.type.startsWith('image/')) {
        return <div data-hapi-composer-attachment-id={previewUrl ?? props.file.name} className="group relative h-16 w-24 shrink-0 overflow-hidden rounded-lg bg-[var(--app-subtle-bg)]">
            <ImagePreview src={previewUrl ?? ''} label="Image" galleryId="messenger-composer-attachments"
                buttonClassName="group h-full w-full cursor-zoom-in overflow-hidden rounded-lg text-left"
                imageClassName="h-full w-full object-cover" />
            <button type="button" onClick={props.onRemove} aria-label="Remove attachment"
                className="hapi-composer-attachment-control absolute right-1 top-1 z-20 flex h-8 w-8 items-start justify-end rounded-md bg-transparent text-white hover:bg-black/15 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-white">
                <span className="flex h-5 w-5 items-center justify-center rounded-md bg-black/40 shadow-sm ring-1 ring-white/20"><CloseIcon className="h-3 w-3" /></span>
            </button>
        </div>
    }
    return (
        <div className="flex w-[calc(50%_-_0.25rem)] min-w-0 max-w-full items-center gap-2 rounded-xl border border-[var(--app-border)] bg-[var(--app-secondary-bg)] p-1.5 sm:w-auto">
            <span className="min-w-0 max-w-32 flex-1 truncate text-xs" title={props.file.name}>{props.file.name}</span>
            <button type="button" onClick={props.onRemove} aria-label={`Remove attachment ${props.file.name}`}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--app-hint)] hover:bg-[var(--app-bg)] hover:text-[var(--app-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)]">
                <CloseIcon className="h-4 w-4" />
            </button>
        </div>
    )
}
