export function imageFileFromClipboard(items: DataTransferItemList): File | null {
    for (const item of Array.from(items)) {
        if (item.kind !== 'file' || !item.type.startsWith('image/')) continue
        const file = item.getAsFile()
        if (file) return file
    }
    return null
}
