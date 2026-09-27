import { describe, expect, it } from 'bun:test'
import { KlipyGifSchema, KlipySearchQuerySchema, KlipySearchResponseSchema } from './klipy'

describe('klipy shared schema', () => {
    it('parses a complete GIF record', () => {
        const parsed = KlipyGifSchema.parse({
            id: 'abc',
            title: 'Cat dance',
            slug: 'cat-dance',
            url: 'https://klipy.example/cat-dance',
            previewUrl: 'https://klipy.example/preview.gif',
            downloadUrl: 'https://klipy.example/download.gif',
            width: 480,
            height: 270
        })
        expect(parsed.id).toBe('abc')
        expect(parsed.title).toBe('Cat dance')
    })

    it('accepts nullable fields when KLIPY omits them', () => {
        const parsed = KlipyGifSchema.parse({
            id: 'x',
            title: '',
            slug: null,
            url: null,
            previewUrl: null,
            downloadUrl: null,
            width: null,
            height: null
        })
        expect(parsed.slug).toBeNull()
    })

    it('rejects a GIF without an id', () => {
        const result = KlipyGifSchema.safeParse({
            id: '',
            title: '',
            slug: null,
            url: null,
            previewUrl: null,
            downloadUrl: null,
            width: null,
            height: null
        })
        expect(result.success).toBe(false)
    })

    it('parses a paginated response', () => {
        const parsed = KlipySearchResponseSchema.parse({
            gifs: [
                {
                    id: '1', title: 'a', slug: null, url: null,
                    previewUrl: null, downloadUrl: null, width: null, height: null
                }
            ],
            next: 'cursor-1'
        })
        expect(parsed.next).toBe('cursor-1')
        expect(parsed.gifs).toHaveLength(1)
    })

    it('accepts null `next` (end of pagination)', () => {
        const parsed = KlipySearchResponseSchema.parse({ gifs: [], next: null })
        expect(parsed.next).toBeNull()
    })

    it('rejects search queries that are empty or too long', () => {
        expect(KlipySearchQuerySchema.safeParse({ q: '' }).success).toBe(false)
        expect(KlipySearchQuerySchema.safeParse({ q: 'a'.repeat(101) }).success).toBe(false)
        expect(KlipySearchQuerySchema.safeParse({ q: 'cat' }).success).toBe(true)
    })

    it('coerces and bounds `limit`', () => {
        // The shared schema is permissive — the server clamps via clampLimit(),
        // so we only assert the schema accepts the string and produces a finite number.
        const parsed = KlipySearchQuerySchema.safeParse({ q: 'cat', limit: '999' })
        expect(parsed.success).toBe(false) // too_big from zod max(48)
        const ok = KlipySearchQuerySchema.safeParse({ q: 'cat', limit: '20' })
        expect(ok.success).toBe(true)
        if (ok.success) expect(ok.data.limit).toBe(20)
    })
})