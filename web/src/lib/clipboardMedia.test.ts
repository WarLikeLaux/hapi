import { describe, expect, it } from 'vitest'
import { imageFileFromClipboard } from './clipboardMedia'

function clipboardItems(...items: Array<Partial<DataTransferItem>>): DataTransferItemList {
    return items as unknown as DataTransferItemList
}

describe('imageFileFromClipboard', () => {
    it('returns the first pasted image and ignores text', () => {
        const image = new File(['png'], 'image.png', { type: 'image/png' })
        const result = imageFileFromClipboard(clipboardItems(
            { kind: 'string', type: 'text/plain', getAsFile: () => null },
            { kind: 'file', type: 'image/png', getAsFile: () => image }
        ))

        expect(result).toBe(image)
    })

    it('does not treat a pasted non-image file as an image', () => {
        const file = new File(['text'], 'notes.txt', { type: 'text/plain' })
        const result = imageFileFromClipboard(clipboardItems(
            { kind: 'file', type: 'text/plain', getAsFile: () => file }
        ))

        expect(result).toBeNull()
    })
})
