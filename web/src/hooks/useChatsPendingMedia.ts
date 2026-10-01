import { useCallback, useEffect, useState, type ClipboardEvent } from 'react'
import { imageFileFromClipboard } from '@/lib/clipboardMedia'

/**
 * Paste-and-review media staging for the chats composer.
 *
 * Without this hook the composer's paste handler eagerly forwards every
 * clipboard image straight into the messenger upload pipeline, which is
 * the source of the "I pasted a screenshot and it sent immediately"
 * complaint. The hook instead parks the file in component state, surfaces
 * a local preview URL, and only releases it when the caller fires
 * `clearPendingMedia()` after the upload succeeds.
 *
 * The caller is responsible for actually uploading the file — the hook
 * has no opinion about which transport to use. That keeps it usable from
 * the `sendMedia` mutation today and from a future staged-send flow
 * without an API change.
 */
export type ChatsPendingMedia = {
    pendingMedia: File | null
    previewUrl: string | null
    setPendingMedia: (file: File | null) => void
    clearPendingMedia: () => void
    /**
     * Wired into the textarea's `onPaste`. Returns true when the hook
     * consumed the event (an image was staged); false when the paste
     * should fall through to the default text-paste behavior.
     */
    handlePaste: (event: ClipboardEvent<HTMLElement>) => boolean
}

export function useChatsPendingMedia(): ChatsPendingMedia {
    const [pendingMedia, setPendingMediaState] = useState<File | null>(null)
    const [previewUrl, setPreviewUrl] = useState<string | null>(null)

    useEffect(() => {
        if (!pendingMedia) {
            setPreviewUrl(null)
            return
        }
        const url = URL.createObjectURL(pendingMedia)
        setPreviewUrl(url)
        return () => URL.revokeObjectURL(url)
    }, [pendingMedia])

    const setPendingMedia = useCallback((file: File | null) => {
        setPendingMediaState(file)
    }, [])

    const clearPendingMedia = useCallback(() => {
        setPendingMediaState(null)
    }, [])

    const handlePaste = useCallback((event: ClipboardEvent<HTMLElement>) => {
        const image = imageFileFromClipboard(event.clipboardData.items)
        if (!image) return false
        event.preventDefault()
        setPendingMediaState(image)
        return true
    }, [])

    return { pendingMedia, previewUrl, setPendingMedia, clearPendingMedia, handlePaste }
}