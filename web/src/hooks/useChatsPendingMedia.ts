import { useCallback, useState, type ClipboardEvent } from 'react'

/** Keep selected and pasted files staged until the user submits the composer. */
export function useChatsPendingMedia() {
    const [pendingMedia, setPendingMedia] = useState<File[]>([])

    const addPendingMedia = useCallback((files: File[]) => {
        setPendingMedia(current => [...current, ...files])
    }, [])
    const removePendingMedia = useCallback((index: number) => {
        setPendingMedia(current => current.filter((_, position) => position !== index))
    }, [])
    const clearPendingMedia = useCallback(() => setPendingMedia([]), [])

    const handlePaste = useCallback((event: ClipboardEvent<HTMLElement>) => {
        const images = Array.from(event.clipboardData.items).flatMap(item => {
            if (item.kind !== 'file' || !item.type.startsWith('image/')) return []
            const file = item.getAsFile()
            return file ? [file] : []
        })
        if (images.length === 0) return false
        event.preventDefault()
        addPendingMedia(images)
        return true
    }, [addPendingMedia])

    return { pendingMedia, addPendingMedia, removePendingMedia, clearPendingMedia, handlePaste }
}
