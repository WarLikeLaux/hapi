export type ExternalMessageSegment =
    | { type: 'text'; text: string }
    | { type: 'link'; text: string; url: string }

// Markdown-style links first so their label survives as link text; only
// http(s) targets are accepted, everything else (e.g. `javascript:`)
// stays literal text.
const MARKDOWN_LINK_SOURCE = '\\[([^\\[\\]]+)\\]\\((https?://[^\\s)]+)\\)'
// Bare URLs: stop at whitespace and at characters that usually delimit
// HTML/markdown, so the anchor never swallows surrounding markup.
const BARE_URL_SOURCE = 'https?://[^\\s<>"\'`]+'
// Sentence punctuation that may legally follow a URL but should not be
// part of the clickable text.
const TRAILING_PUNCTUATION = /[.,;:!?…"'»”“]+$/

function trimBareUrl(url: string): { url: string; trailing: string } {
    let value = url.replace(TRAILING_PUNCTUATION, '')
    // Strip a closing bracket only when it is genuinely outside the URL
    // (more closers than openers), keeping Wikipedia-style `(Y)` links.
    while (value.endsWith(')') || value.endsWith(']')) {
        const closer = value.endsWith(')') ? ')' : ']'
        const opener = closer === ')' ? '(' : '['
        const openers = countOccurrences(value, opener)
        const closers = countOccurrences(value, closer)
        if (closers <= openers) break
        value = value.slice(0, -1)
    }
    return { url: value, trailing: url.slice(value.length) }
}

function countOccurrences(value: string, needle: string): number {
    let count = 0
    for (let index = value.indexOf(needle); index >= 0; index = value.indexOf(needle, index + 1)) {
        count += 1
    }
    return count
}

function pushPlain(segments: ExternalMessageSegment[], plain: string): void {
    if (!plain) return
    const bare = new RegExp(BARE_URL_SOURCE, 'g')
    let index = 0
    for (let match = bare.exec(plain); match; match = bare.exec(plain)) {
        if (match.index > index) {
            segments.push({ type: 'text', text: plain.slice(index, match.index) })
        }
        const { url, trailing } = trimBareUrl(match[0])
        segments.push({ type: 'link', text: url, url })
        if (trailing) segments.push({ type: 'text', text: trailing })
        index = match.index + match[0].length
    }
    if (index < plain.length) segments.push({ type: 'text', text: plain.slice(index) })
}

/**
 * Split a messenger message into plain-text and clickable-link segments.
 *
 * Markdown `[label](https://…)` links keep their label as the link text;
 * bare `https://…` URLs link themselves with trailing sentence punctuation
 * excluded. Non-http(s) markdown targets are left as literal text.
 */
export function parseExternalMessageSegments(text: string): ExternalMessageSegment[] {
    if (!text) return []
    const markdown = new RegExp(MARKDOWN_LINK_SOURCE, 'g')
    const segments: ExternalMessageSegment[] = []
    let lastIndex = 0
    for (let match = markdown.exec(text); match; match = markdown.exec(text)) {
        if (match.index > lastIndex) {
            pushPlain(segments, text.slice(lastIndex, match.index))
        }
        segments.push({ type: 'link', text: match[1], url: match[2] })
        lastIndex = match.index + match[0].length
    }
    if (lastIndex < text.length) pushPlain(segments, text.slice(lastIndex))
    return mergeAdjacentText(segments)
}

function mergeAdjacentText(segments: ExternalMessageSegment[]): ExternalMessageSegment[] {
    const merged: ExternalMessageSegment[] = []
    for (const segment of segments) {
        const last = merged[merged.length - 1]
        if (segment.type === 'text' && last?.type === 'text') {
            last.text += segment.text
        } else {
            merged.push({ ...segment })
        }
    }
    return merged
}
