import { useEffect, useId, useRef, useState, type ClipboardEvent } from 'react'
import { MAX_INITIAL_IMAGE_BYTES } from '@hapi/protocol'
import { useTranslation } from '@/lib/use-translation'
import { ImagePreview } from '@/components/ImagePreview'
import { Spinner } from '@/components/Spinner'
import { getInitialImageFile, InitialImageDraftSchema, saveInitialImage, type InitialImageDraft } from './initialImageDrafts'

type Props = {
    label: string
    value: string
    onChange: (value: string) => void
    images: InitialImageDraft[]
    onImagesChange: (images: InitialImageDraft[]) => void
    onReadingChange: (reading: boolean) => void
    agent?: string
    disabled: boolean
    placeholder: string
}

function ImageThumbnail({ image, galleryId }: { image: InitialImageDraft; galleryId: string }) {
    const { t } = useTranslation()
    const [src, setSrc] = useState('')
    const [error, setError] = useState(false)
    useEffect(() => {
        let disposed = false
        let url: string | undefined
        void getInitialImageFile(image).then(file => {
            if (disposed) return
            url = URL.createObjectURL(file)
            setSrc(url)
        }).catch(() => { if (!disposed) setError(true) })
        return () => { disposed = true; if (url) URL.revokeObjectURL(url) }
    }, [image.id])
    if (error) return <span role="alert" className="flex h-full items-center justify-center p-1 text-center text-xs text-red-600" title={t('newSession.imageUnavailable')}>{t('newSession.imageUnavailable')}</span>
    if (!src) return <div className="flex h-full items-center justify-center"><Spinner size="sm" label={null} /></div>
    return <ImagePreview src={src} label="Image" galleryId={galleryId}
        buttonClassName="group h-full w-full cursor-zoom-in overflow-hidden rounded-lg text-left"
        imageClassName="h-full w-full object-cover" />
}

export function InitialPrompt(props: Props) {
    const { t } = useTranslation()
    const inputId = useId()
    const galleryId = useId()
    const [error, setError] = useState<string | null>(null)
    const reading = useRef(false)
    const [isReading, setIsReading] = useState(false)
    const fileInput = useRef<HTMLInputElement>(null)
    async function paste(event: ClipboardEvent<HTMLTextAreaElement>) {
        const files = Array.from(event.clipboardData.items)
            .filter(item => item.kind === 'file' && item.type.startsWith('image/'))
            .map(item => item.getAsFile()).filter((file): file is File => file !== null)
        if (!files.length) return // Let the browser perform ordinary text pastes.
        event.preventDefault()
        const text = event.clipboardData.getData?.('text/plain') ?? ''
        if (text) {
            const input = event.currentTarget
            props.onChange((props.value.slice(0, input.selectionStart) + text + props.value.slice(input.selectionEnd)).slice(0, 100000))
        }
        await addFiles(files)
    }
    async function addFiles(files: File[]) {
        if (!files.length) return
        setError(null)
        if (reading.current) return
        const total = [...props.images, ...files].reduce((sum, image) => sum + image.size, 0)
        if (total > MAX_INITIAL_IMAGE_BYTES || files.some(file => !InitialImageDraftSchema.omit({ id: true }).safeParse({
            filename: file.name || 'clipboard.png', mimeType: file.type, size: file.size,
        }).success)) {
            setError(t('newSession.imagesInvalid')); return
        }
        reading.current = true
        setIsReading(true)
        props.onReadingChange(true)
        try {
            const added = await Promise.all(files.map(saveInitialImage))
            props.onImagesChange([...props.images, ...added])
        } catch {
            setError(t('newSession.imagesSaveFailed'))
        } finally {
            reading.current = false
            setIsReading(false)
            props.onReadingChange(false)
        }
    }
    return <div className="space-y-1.5">
        <label htmlFor={inputId} className="block text-xs font-medium text-[var(--app-hint)]">{props.label}</label>
        <div className="rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] focus-within:outline-2 focus-within:outline-[var(--app-link)]">
            {props.images.length ? <ul className="flex flex-wrap gap-2 px-3 pt-3" aria-label={t('newSession.attachedImages')}>
                {props.images.map((image) => <li key={image.id} data-hapi-composer-attachment-id={image.id}
                    className="group relative h-16 w-24 overflow-hidden rounded-lg bg-[var(--app-subtle-bg)]">
                    <ImageThumbnail image={image} galleryId={galleryId} />
                    <button type="button" className="hapi-composer-attachment-control absolute right-1 top-1 z-20 flex h-8 w-8 items-start justify-end rounded-md bg-transparent text-white transition-colors hover:bg-black/15 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-white disabled:opacity-50"
                        disabled={props.disabled || isReading} aria-label={t('newSession.removeImage')} title={t('newSession.removeImage')}
                        onClick={() => { props.onImagesChange(props.images.filter(item => item.id !== image.id)); setError(null) }}>
                        <span className="flex h-5 w-5 items-center justify-center rounded-md bg-black/40 shadow-sm ring-1 ring-white/20">
                            <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="m3 3 6 6M3 9l6-6" /></svg>
                        </span>
                    </button>
                </li>)}
            </ul> : null}
            <textarea id={inputId} className="min-h-24 w-full resize-y rounded-md bg-transparent px-3 py-2 text-sm font-normal text-[var(--app-fg)] outline-none disabled:opacity-50"
                rows={3} maxLength={100000} value={props.value} disabled={props.disabled}
                placeholder={props.placeholder} onChange={event => props.onChange(event.target.value)} onPaste={paste} />
            <div className="flex items-center gap-2 px-2 pb-2 pt-1">
                <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple className="hidden" onChange={event => { void addFiles(Array.from(event.currentTarget.files ?? [])); event.currentTarget.value = '' }} />
                <button type="button" aria-label={t('composer.attach')} title={t('composer.attach')} disabled={props.disabled || isReading} onClick={() => fileInput.current?.click()} className="flex h-9 w-9 items-center justify-center rounded-md text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)] focus-visible:outline-2 focus-visible:outline-[var(--app-link)] disabled:opacity-50">
                    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21.4 11.1-8.5 8.5a6 6 0 0 1-8.5-8.5l8.5-8.5a4 4 0 0 1 5.7 5.7l-8.5 8.5a2 2 0 0 1-2.8-2.8l7.8-7.8" /></svg>
                </button>
            </div>
        </div>
        {isReading ? <p role="status" className="text-xs text-[var(--app-hint)]">{t('newSession.imagesReading')}</p> : null}
        <p className="text-xs text-[var(--app-hint)]">{t('newSession.imagesHint')}</p>
        {error ? <p role="alert" className="text-sm text-red-600">{error}</p> : null}
    </div>
}
