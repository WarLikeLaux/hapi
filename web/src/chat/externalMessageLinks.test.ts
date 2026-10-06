import { describe, expect, it } from 'vitest'
import { parseExternalMessageSegments } from './externalMessageLinks'

describe('parseExternalMessageSegments', () => {
    it('returns a single text segment for plain text without URLs', () => {
        expect(parseExternalMessageSegments('просто текст')).toEqual([
            { type: 'text', text: 'просто текст' }
        ])
    })

    it('returns an empty list for empty input', () => {
        expect(parseExternalMessageSegments('')).toEqual([])
    })

    it('links a bare URL and keeps trailing sentence punctuation outside the link', () => {
        expect(parseExternalMessageSegments('открой https://example.org/b. Потом продолжим')).toEqual([
            { type: 'text', text: 'открой ' },
            { type: 'link', text: 'https://example.org/b', url: 'https://example.org/b' },
            { type: 'text', text: '. Потом продолжим' }
        ])
    })

    it('keeps balanced parentheses inside a bare URL', () => {
        expect(parseExternalMessageSegments('см. https://en.wikipedia.org/w/X_(Y) рядом')).toEqual([
            { type: 'text', text: 'см. ' },
            { type: 'link', text: 'https://en.wikipedia.org/w/X_(Y)', url: 'https://en.wikipedia.org/w/X_(Y)' },
            { type: 'text', text: ' рядом' }
        ])
    })

    it('strips an unbalanced closing parenthesis from a bare URL', () => {
        expect(parseExternalMessageSegments('(см. https://example.com/a)')).toEqual([
            { type: 'text', text: '(см. ' },
            { type: 'link', text: 'https://example.com/a', url: 'https://example.com/a' },
            { type: 'text', text: ')' }
        ])
    })

    it('converts markdown links into labelled anchors', () => {
        expect(parseExternalMessageSegments('смотри [док](https://example.com/a) и ещё')).toEqual([
            { type: 'text', text: 'смотри ' },
            { type: 'link', text: 'док', url: 'https://example.com/a' },
            { type: 'text', text: ' и ещё' }
        ])
    })

    it('leaves non-http markdown targets as literal text', () => {
        expect(parseExternalMessageSegments('[x](javascript:alert(1))')).toEqual([
            { type: 'text', text: '[x](javascript:alert(1))' }
        ])
    })

    it('finds bare URLs inside plain runs around markdown links', () => {
        expect(parseExternalMessageSegments('[a](https://one.test) затем https://two.test!')).toEqual([
            { type: 'link', text: 'a', url: 'https://one.test' },
            { type: 'text', text: ' затем ' },
            { type: 'link', text: 'https://two.test', url: 'https://two.test' },
            { type: 'text', text: '!' }
        ])
    })
})
