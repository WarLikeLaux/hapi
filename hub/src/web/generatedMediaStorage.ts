import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { MAX_GENERATED_IMAGE_BYTES } from '../socket/socketLimits'

type StoredGeneratedMediaMetadata = {
    fileName: string
    mimeType: string
    size: number
}

export type StoredGeneratedMedia = StoredGeneratedMediaMetadata & {
    bytes: Buffer
}

function storageId(value: string): string {
    return createHash('sha256').update(value).digest('hex')
}

function getStoragePaths(dataDir: string, namespace: string, sessionId: string, imageId: string) {
    const directory = join(
        dataDir,
        'generated-media',
        storageId(namespace),
        storageId(sessionId)
    )
    const baseName = storageId(imageId)
    return {
        directory,
        content: join(directory, `${baseName}.bin`),
        metadata: join(directory, `${baseName}.json`),
    }
}

function parseMetadata(value: unknown): StoredGeneratedMediaMetadata | null {
    if (!value || typeof value !== 'object') return null
    const record = value as Record<string, unknown>
    if (typeof record.fileName !== 'string' || !record.fileName || record.fileName.length > 255) return null
    if (typeof record.mimeType !== 'string' || !record.mimeType || record.mimeType.length > 255) return null
    if (typeof record.size !== 'number' || !Number.isSafeInteger(record.size) || record.size < 0 || record.size > MAX_GENERATED_IMAGE_BYTES) return null
    return {
        fileName: record.fileName,
        mimeType: record.mimeType,
        size: record.size,
    }
}

export async function readStoredGeneratedMedia(
    dataDir: string,
    namespace: string,
    sessionId: string,
    imageId: string
): Promise<StoredGeneratedMedia | null> {
    const paths = getStoragePaths(dataDir, namespace, sessionId, imageId)
    try {
        const rawMetadata = await readFile(paths.metadata, 'utf8')
        if (rawMetadata.length > 2_048) return null
        const metadata = parseMetadata(JSON.parse(rawMetadata))
        if (!metadata) return null
        const info = await stat(paths.content)
        if (!info.isFile() || info.size !== metadata.size) return null
        const bytes = await readFile(paths.content)
        return { ...metadata, bytes }
    } catch {
        return null
    }
}

export async function writeStoredGeneratedMedia(
    dataDir: string,
    namespace: string,
    sessionId: string,
    imageId: string,
    media: Omit<StoredGeneratedMedia, 'size'>
): Promise<void> {
    if (media.bytes.byteLength > MAX_GENERATED_IMAGE_BYTES) {
        throw new Error('Generated media is too large to store')
    }
    const paths = getStoragePaths(dataDir, namespace, sessionId, imageId)
    const temporarySuffix = `.tmp-${randomUUID()}`
    const temporaryContent = `${paths.content}${temporarySuffix}`
    const temporaryMetadata = `${paths.metadata}${temporarySuffix}`
    const metadata: StoredGeneratedMediaMetadata = {
        fileName: media.fileName.slice(0, 255),
        mimeType: media.mimeType.slice(0, 255),
        size: media.bytes.byteLength,
    }

    await mkdir(paths.directory, { recursive: true, mode: 0o700 })
    try {
        await writeFile(temporaryContent, media.bytes, { mode: 0o600 })
        await writeFile(temporaryMetadata, JSON.stringify(metadata), { mode: 0o600 })
        await rename(temporaryContent, paths.content)
        await rename(temporaryMetadata, paths.metadata)
    } finally {
        await Promise.all([
            rm(temporaryContent, { force: true }),
            rm(temporaryMetadata, { force: true }),
        ])
    }
}
