import { describe, expect, it } from 'bun:test'
import {
    KlipyCategoriesResponseSchema,
    KlipyGifSchema,
    KlipySearchQuerySchema,
    KlipySearchResponseSchema
} from './klipy'

describe('klipy shared schema', () => {
    it('parses a complete GIF record with file variants', () => {
        const parsed = KlipyGifSchema.parse({
            id: '4978743036025682',
            slug: 'siddharth-ji',
            title: 'Good Morning',
            blurPreview: null,
            previewUrl: 'https://static.klipy.com/ii/.../xs.jpg',
            downloadUrl: 'https://static.klipy.com/ii/.../sm.gif',
            width: 220,
            height: 352
        })
        expect(parsed.id).toBe('4978743036025682')
        expect(parsed.slug).toBe('siddharth-ji')
    })

    it('accepts nullable fields when KLIPY omits them', () => {
        const parsed = KlipyGifSchema.parse({
            id: 'x',
            slug: null,
            title: '',
            blurPreview: null,
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
            slug: null,
            title: '',
            blurPreview: null,
            previewUrl: null,
            downloadUrl: null,
            width: null,
            height: null
        })
        expect(result.success).toBe(false)
    })

    it('parses a paginated response with `next` page number', () => {
        const parsed = KlipySearchResponseSchema.parse({
            gifs: [
                {
                    id: '1', slug: null, title: 'a', blurPreview: null,
                    previewUrl: null, downloadUrl: null, width: null, height: null
                }
            ],
            next: 2
        })
        expect(parsed.next).toBe(2)
        expect(parsed.gifs).toHaveLength(1)
    })

    it('accepts null `next` (end of pagination)', () => {
        const parsed = KlipySearchResponseSchema.parse({ gifs: [], next: null })
        expect(parsed.next).toBeNull()
    })

    it('rejects search queries that are empty or too long', () => {
        expect(KlipySearchQuerySchema.safeParse({}).success).toBe(true) // q is optional now
        expect(KlipySearchQuerySchema.safeParse({ q: '' }).success).toBe(false)
        expect(KlipySearchQuerySchema.safeParse({ q: 'a'.repeat(101) }).success).toBe(false)
        expect(KlipySearchQuerySchema.safeParse({ q: 'cat' }).success).toBe(true)
    })

    it('bounds `per_page` to a sane max', () => {
        const parsed = KlipySearchQuerySchema.safeParse({ q: 'cat', per_page: '999' })
        expect(parsed.success).toBe(false)
        const ok = KlipySearchQuerySchema.safeParse({ q: 'cat', per_page: '20' })
        expect(ok.success).toBe(true)
        if (ok.success) expect(ok.data.per_page).toBe(20)
    })

    it('parses a categories response', () => {
        const parsed = KlipyCategoriesResponseSchema.parse({
            categories: [
                { category: 'hello', query: 'hello', previewUrl: 'https://static.klipy.com/x.gif' }
            ],
            locale: 'en_US'
        })
        expect(parsed.categories).toHaveLength(1)
        expect(parsed.locale).toBe('en_US')
    })
})