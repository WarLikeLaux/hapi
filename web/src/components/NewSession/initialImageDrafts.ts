import { AttachmentMetadataSchema } from '@hapi/protocol/schemas'
import { InitialImageSchema, InitialImagesSchema, MAX_INITIAL_IMAGE_BYTES, type InitialImage } from '@hapi/protocol'

export const InitialImageDraftSchema = InitialImageSchema.omit({ content: true }).extend({
    id: AttachmentMetadataSchema.shape.id.uuid(),
    size: AttachmentMetadataSchema.shape.size.int().positive().max(MAX_INITIAL_IMAGE_BYTES),
})
export type InitialImageDraft = Omit<InitialImage, 'content'> & { id: string; size: number }
type StoredImage = InitialImageDraft & { file: Blob; createdAt: number }
const DB_NAME = 'hapi-initial-images'
const STORE = 'images'
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
// Tests and environments without IndexedDB keep the same in-tab behavior.
const memory = new Map<string, StoredImage>()

async function openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1)
        request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' })
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error ?? new Error('Could not open image storage'))
    })
}

export async function saveInitialImage(file: File): Promise<InitialImageDraft> {
    const draft = InitialImageDraftSchema.parse({ id: crypto.randomUUID(), filename: file.name || 'clipboard.png', mimeType: file.type, size: file.size })
    const record: StoredImage = { ...draft, file, createdAt: Date.now() }
    if (typeof indexedDB === 'undefined') memory.set(draft.id, record)
    else {
        const db = await openDb()
        try {
            await new Promise<void>((resolve, reject) => {
                const transaction = db.transaction(STORE, 'readwrite')
                const store = transaction.objectStore(STORE)
                store.put(record)
                // Abandoned forms must not retain large clipboard images forever.
                const cursor = store.openCursor()
                cursor.onsuccess = () => {
                    const item = cursor.result
                    if (!item) return
                    if ((item.value as StoredImage).createdAt < Date.now() - MAX_AGE_MS) item.delete()
                    item.continue()
                }
                transaction.oncomplete = () => resolve()
                transaction.onerror = transaction.onabort = () => reject(transaction.error ?? new Error('Could not save image'))
            })
        } finally { db.close() }
    }
    return draft
}

export async function getInitialImageFile(draft: InitialImageDraft): Promise<Blob> {
    let record = memory.get(draft.id)
    if (typeof indexedDB !== 'undefined') {
        const db = await openDb()
        try {
            record = await new Promise<StoredImage | undefined>((resolve, reject) => {
                const transaction = db.transaction(STORE, 'readonly')
                const request = transaction.objectStore(STORE).get(draft.id)
                transaction.oncomplete = () => resolve(request.result as StoredImage | undefined)
                transaction.onerror = transaction.onabort = () => reject(transaction.error ?? new Error('Could not read image'))
            })
        } finally { db.close() }
    }
    if (!record || record.filename !== draft.filename || record.mimeType !== draft.mimeType || record.size !== draft.size) {
        throw new Error('Image is no longer available. Remove it and paste it again.')
    }
    return record.file
}

export async function resolveInitialImages(drafts: InitialImageDraft[] | undefined): Promise<InitialImage[] | undefined> {
    if (!drafts?.length) return undefined
    const images = await Promise.all(drafts.map(async draft => {
        const file = await getInitialImageFile(draft)
        const content = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
            reader.onerror = () => reject(new Error('Could not read image. Remove it and paste it again.'))
            reader.readAsDataURL(file)
        })
        return { filename: draft.filename, mimeType: draft.mimeType, content }
    }))
    return InitialImagesSchema.parse(images)
}
