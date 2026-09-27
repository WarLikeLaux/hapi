import { createRoot } from 'react-dom/client'
import { useRef, useState } from 'react'
import { ImagePreview } from '@/components/ImagePreview'

const RED_PNG =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

type Attachment = { name: string; status: { type: string }; previewUrl: string | undefined }

// Mirrors the fix applied to AttachmentItem.tsx: keep ImagePreview mounted
// once the attachment ever exposes a preview, so a transient previewUrl
// flicker does not reset the open lightbox.
function AttachmentItemFixed(props: { attachment: Attachment }) {
    const hasPreview = Boolean(props.attachment.previewUrl) && props.attachment.status.type !== 'incomplete'
    const hadPreviewRef = useRef(hasPreview)
    if (hasPreview) hadPreviewRef.current = true
    const renderImagePreview = hadPreviewRef.current

    if (renderImagePreview) {
        return (
            <div
                className="group relative h-16 w-24 overflow-hidden rounded-lg"
                data-testid="attachment-root"
                data-preview-url={props.attachment.previewUrl ?? ''}
            >
                <ImagePreview
                    src={props.attachment.previewUrl ?? ''}
                    fileName={props.attachment.name}
                    label={props.attachment.name}
                    galleryId="composer-attachments"
                    buttonClassName={`group h-full w-full cursor-zoom-in overflow-hidden rounded-lg text-left ${hasPreview ? '' : 'hidden'}`}
                    imageClassName="h-full w-full object-cover"
                />
                {!hasPreview ? (
                    <div className="flex h-full w-full items-center justify-center rounded-lg bg-[var(--app-subtle-bg)] px-2 text-[10px] text-[var(--app-hint)]" data-testid="attachment-preview-placeholder">
                        <span className="truncate">{props.attachment.name}</span>
                    </div>
                ) : null}
            </div>
        )
    }
    return (
        <div data-testid="attachment-root" data-preview-url={props.attachment.previewUrl ?? ''}>
            <span>{props.attachment.name}</span>
        </div>
    )
}

function Demo() {
    const [attachment, setAttachment] = useState<Attachment>({
        name: 'pasted.png',
        status: { type: 'complete' },
        previewUrl: RED_PNG,
    })

    return (
        <div style={{ padding: 24, background: '#0b0d10', color: '#edf1f5' }}>
            <h3>AttachmentItem (fixed pattern)</h3>
            <AttachmentItemFixed attachment={attachment} />
            <div className="mt-4 flex gap-2">
                <button
                    id="clear-preview"
                    type="button"
                    onClick={() => setAttachment((a) => ({ ...a, previewUrl: undefined }))}
                    className="rounded bg-red-500 px-3 py-1 text-white"
                >
                    Clear previewUrl
                </button>
                <button
                    id="restore-preview"
                    type="button"
                    onClick={() => setAttachment((a) => ({ ...a, previewUrl: RED_PNG }))}
                    className="rounded bg-emerald-500 px-3 py-1 text-white"
                >
                    Restore previewUrl
                </button>
            </div>
        </div>
    )
}

const root = document.getElementById('root')
if (!root) throw new Error('missing #root')

createRoot(root).render(<Demo />)