/**
 * Yandex Messenger reaction Type (int) -> approximating emoji, captured from the
 * chats-web bundle by the reference project (conarti/yandex-messenger-mcp, 2026-07-17).
 *
 * Yandex does not render Unicode emoji: a reaction is a PNG artwork from the server, so
 * `emoji` is our text approximation, not something the server sends. Several sets alias
 * the same emoji (legacy/seasonal/extended thumbs-up), which is fine for display: the
 * aggregate groups by wire Type and we only need a human-readable face for HAPI's picker.
 */

export const REACTION_EMOJI_BY_TYPE: Record<number, string> = {
    10084: '❤', // heart
    100001: '😷🎅', // mask-ny
    100002: '🪿🎅', // goose-ny
    100003: '📆', // 309
    100004: '🍂🔥', // rowan
    100005: '✚✚', // review-2
    100006: '✚✚✚', // review-3
    100007: '✚✚✚✚', // review-4
    100008: '👍', // like-ny
    100009: '👎', // dislike-ny
    100101: '✅', // check-ext
    100102: '👍', // like-ext
    100103: '👎', // dislike-ext
    100104: '🔥', // flame-ext
    100105: '😭', // crying-ext
    100106: '😲', // surprised-ext
    100107: '🪿', // goose-ext
    100108: '😄', // laugh-ext
    100109: '❤️', // heart-ext
    100110: '👀', // eyes-ext
    100111: '➕', // plus-ext
    100112: '😨', // terrible-ext
    100113: '✚✚✚✚', // 4plus-ext
    100114: '👌', // ok-ext
    100115: '🤯', // mindblowing-ext
    100116: '💔', // heartbroke-ext
    100117: '🫡', // salute-ext
    100118: '🤮', // puke-ext
    100119: '💩', // poo-ext
    100120: '✋', // hand-ext
    100121: '🗿', // sigma-ext
    100122: '🤦', // facepalm-ext
    100123: '🎉', // celebration-ext
    100124: '➖', // minus-ext
    100125: '😍', // inlove-ext
    100126: '🤔', // think-ext
    100127: '🤡', // clown-ext
    100128: '😐', // pokerface-ext
    100129: '👏', // applause-ext
    100130: '😎', // glass-ext
    100131: '💯', // onehundred-ext
    100132: '👍💐', // like-tulips
    100133: '👎💐', // dislike-tulips
    127818: '🍊', // tangerine
    128077: '👍', // like
    128078: '👎', // dislike
    128293: '🔥', // fire
    128518: '😆', // laugh
    128525: '😍', // love
    128557: '😭', // cry
    128562: '😲', // wow
    129393: '🥱' // boredom
}

/** Emoji types in descending preference order, used to resolve an emoji to one wire Type. */
const TYPE_BY_EMOJI: Map<string, number> = (() => {
    const map = new Map<string, number>()
    const preferred = [100102, 100103, 100104, 100108, 100109, 100105, 100106, 100110, 100101, 10084,
        128077, 128078, 128293, 128518, 128525, 128557, 128562, 127818, 129393]
    for (const type of preferred) {
        const emoji = REACTION_EMOJI_BY_TYPE[type]
        // First occurrence wins: later preferred aliases (raw thumbs-up) must not
        // overwrite the extended-set type picked earlier in the array.
        if (emoji !== undefined && !map.has(emoji)) map.set(emoji, type)
    }
    for (const [type, emoji] of Object.entries(REACTION_EMOJI_BY_TYPE)) {
        const numeric = Number(type)
        if (!map.has(emoji)) map.set(emoji, numeric)
    }
    return map
})()

/**
 * Resolves a HAPI reaction emoji to a wire Type. Falls back to the emoji's own Unicode
 * codepoint: the legacy set uses codepoints as Types (10084 == U+2764 ❤), so plain
 * emoji the map has never seen still have a honest chance of being valid.
 */
export function reactionTypeForEmoji(emoji: string): number | null {
    const mapped = TYPE_BY_EMOJI.get(emoji)
    if (mapped !== undefined) return mapped
    const codePoint = emoji.codePointAt(0)
    if (codePoint !== undefined && codePoint > 0x1000) return codePoint
    return null
}

/**
 * Resolves a wire reaction key — the `ExternalReaction.reaction` string the web
 * picker echoes back — to a Type. Keys follow the Telegram connector's convention
 * (`emoji:<emoticon>`); types missing from the map round-trip as `type:<n>`. Bare
 * emoji from snapshots taken before the prefix convention are still accepted.
 */
export function reactionTypeForKey(key: string): number | null {
    if (key.startsWith('emoji:')) return reactionTypeForEmoji(key.slice('emoji:'.length))
    const typed = /^type:(\d+)$/.exec(key)
    if (typed) {
        const type = Number(typed[1])
        return Number.isSafeInteger(type) && type > 0 ? type : null
    }
    return reactionTypeForEmoji(key)
}
