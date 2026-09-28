import { describe, expect, it } from 'bun:test'
import { buildFileClientMessage, buildImageClientMessage } from './pushShape'

const PNG_BYTES = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x07, 0x80,
    0x00, 0x00, 0x04, 0x38,
    0x08, 0x02, 0x00, 0x00, 0x00
])

describe('buildImageClientMessage', () => {
    it('attaches Width/Height parsed from a PNG header', () => {
        const message = buildImageClientMessage({
            chatId: 'chat-1',
            payloadId: 'payload-1',
            fileId: 'bucket/uuid-1',
            fileName: 'photo.png',
            size: 1234,
            bytes: PNG_BYTES,
            mimeType: 'image/png'
        })
        expect(message).toEqual({
            Plain: {
                ChatId: 'chat-1',
                PayloadId: 'payload-1',
                Image: {
                    Width: 1920,
                    Height: 1080,
                    FileInfo: {
                        Id2: 'bucket/uuid-1',
                        Name: 'photo.png',
                        Size: 1234,
                        Source: 1
                    }
                }
            }
        })
    })

    it('omits Width/Height when the header cannot be parsed', () => {
        const opaque = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04])
        const message = buildImageClientMessage({
            chatId: 'chat-1',
            payloadId: 'payload-1',
            fileId: 'bucket/uuid-1',
            fileName: 'broken.png',
            size: 5,
            bytes: opaque,
            mimeType: 'image/png'
        })
        expect(message).toEqual({
            Plain: {
                ChatId: 'chat-1',
                PayloadId: 'payload-1',
                Image: {
                    FileInfo: {
                        Id2: 'bucket/uuid-1',
                        Name: 'broken.png',
                        Size: 5,
                        Source: 1
                    }
                }
            }
        })
    })

    it('always sets Source = 1 (DISK)', () => {
        const message = buildImageClientMessage({
            chatId: 'chat-1',
            payloadId: 'payload-1',
            fileId: 'bucket/uuid-1',
            fileName: 'photo.jpg',
            size: 100,
            bytes: PNG_BYTES,
            mimeType: 'image/jpeg'
        })
        const image = (message as { Plain: { Image: { FileInfo: { Source: number } } } }).Plain.Image
        expect(image.FileInfo.Source).toBe(1)
    })
})

describe('buildFileClientMessage', () => {
    it('wraps the FileInfo in a MiscFile body with no dimensions', () => {
        const message = buildFileClientMessage({
            chatId: 'chat-1',
            payloadId: 'payload-1',
            fileId: 'bucket/uuid-1',
            fileName: 'report.pdf',
            size: 5678
        })
        expect(message).toEqual({
            Plain: {
                ChatId: 'chat-1',
                PayloadId: 'payload-1',
                MiscFile: {
                    FileInfo: {
                        Id2: 'bucket/uuid-1',
                        Name: 'report.pdf',
                        Size: 5678,
                        Source: 1
                    }
                }
            }
        })
    })
})
