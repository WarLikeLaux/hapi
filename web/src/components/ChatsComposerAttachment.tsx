import { useEffect, useState } from 'react'
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

    return (
        <div className="flex w-[calc(50%_-_0.25rem)] min-w-0 max-w-full items-center gap-2 rounded-xl border border-[var(--app-border)] bg-[var(--app-secondary-bg)] p-1.5 sm:w-auto">
            {previewUrl ? <img src={previewUrl} alt={props.file.name} className="h-14 w-14 shrink-0 rounded-md object-cover" /> : null}
            <span className="min-w-0 max-w-32 flex-1 truncate text-xs" title={props.file.name}>{props.file.name}</span>
            <button
                type="button"
                onClick={props.onRemove}
                aria-label={`Remove attachment ${props.file.name}`}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--app-hint)] hover:bg-[var(--app-bg)] hover:text-[var(--app-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)]"
            ><CloseIcon className="h-4 w-4" /></button>
        </div>
    )
}
