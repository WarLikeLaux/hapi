import type { ExternalConversation, ExternalMedia, ExternalMessage, ExternalReaction } from '@hapi/protocol'
import { id, number, object, objects, type MaxObject } from './client'

export function mediaUrl(value: unknown): string | null {
    if (typeof value !== 'string') return null
    try {
        const url = new URL(value)
        const allowed = ['oneme.ru', 'okcdn.ru'].some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))
        return url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443') && allowed
            ? url.href : null
    } catch { return null }
}

export function contactName(contact: MaxObject): string | null {
    for (const name of objects(contact.names)) {
        if (typeof name.name === 'string' && name.name.trim()) return name.name.trim()
        const parts = [name.firstName, name.lastName].filter((part): part is string => typeof part === 'string' && Boolean(part.trim()))
        if (parts.length) return parts.join(' ')
    }
    return null
}

export function avatarUrl(raw: MaxObject): string | null {
    return mediaUrl(raw.baseUrl) ?? mediaUrl(object(raw.picture).url)
}

export function reactions(raw: unknown): ExternalReaction[] {
    const info = object(raw)
    return objects(info.counters).flatMap(counter => {
        const emoji = typeof counter.reaction === 'string' ? counter.reaction : object(counter.reaction).id
        const count = number(counter.count)
        if (typeof emoji !== 'string' || !emoji || !Number.isInteger(count) || count < 1) return []
        const chosen = typeof info.yourReaction === 'string' ? info.yourReaction : object(info.yourReaction).id
        return [{ reaction: `emoji:${emoji}`, emoji, count, chosen: chosen === emoji }]
    })
}

export function attachments(message: MaxObject): MaxObject[] {
    const forwarded = object(message.link)
    const content = forwarded.type === 'FORWARD' ? object(forwarded.message) : message
    return objects(content.attaches).filter(attach => !['CONTROL', 'CALL', 'SHARE', 'INLINE_KEYBOARD'].includes(String(attach._type)))
}

function normalizeMedia(attach: MaxObject): ExternalMedia {
    const kinds: Record<string, ExternalMedia['kind']> = {
        PHOTO: 'image', VIDEO: 'video', AUDIO: 'voice', FILE: 'file', STICKER: 'sticker'
    }
    const animatedPhoto = attach._type === 'PHOTO' && Boolean(mediaUrl(attach.mp4Url))
    const stickerVideo = attach._type === 'STICKER' && Boolean(mediaUrl(attach.mp4Url))
    const stickerLottie = attach._type === 'STICKER' && !stickerVideo && Boolean(mediaUrl(attach.lottieUrl))
    const kind = animatedPhoto ? 'video' : kinds[String(attach._type)] ?? 'other'
    const preview = typeof attach.previewData === 'string' && attach.previewData.length < 256_000
        && /^[A-Za-z0-9+/=\s]+$/.test(attach.previewData)
        ? `data:image/jpeg;base64,${attach.previewData}` : null
    return {
        kind,
        mimeType: animatedPhoto || stickerVideo ? 'video/mp4' : stickerLottie ? 'application/json'
            : typeof attach.mimeType === 'string' ? attach.mimeType
            : kind === 'image' ? 'image/jpeg' : kind === 'video' ? 'video/mp4' : null,
        fileName: typeof attach.name === 'string' ? attach.name : typeof attach.fileName === 'string' ? attach.fileName : null,
        size: Math.max(0, Math.trunc(number(attach.size ?? attach.fileSize))) || null,
        thumbnailDataUrl: preview,
        ...(animatedPhoto || stickerVideo || stickerLottie ? { isAnimated: true } : {}),
        ...(kind === 'voice' && number(attach.duration) > 0 ? { duration: number(attach.duration) / 1000 } : {})
    }
}

export function normalizeMessage(remoteId: string, raw: MaxObject, selfId: string, contacts: Map<string, MaxObject>): ExternalMessage | null {
    const messageId = id(raw.id)
    if (!messageId || !Number.isSafeInteger(raw.time)) return null
    const senderId = id(raw.sender)
    const contact = contacts.get(senderId ?? '') ?? {}
    const link = object(raw.link)
    const content = link.type === 'FORWARD' ? object(link.message) : raw
    const reply = object(link.message)
    const links = objects(content.elements).flatMap(element => {
        const url = object(element.attributes).url
        return element.type === 'LINK' && typeof url === 'string' && Number.isInteger(element.from) && Number.isInteger(element.length)
            && number(element.from) >= 0 && number(element.length) > 0
            ? [{ offset: number(element.from), length: number(element.length), url }] : []
    })
    return {
        id: `max:${remoteId}:${messageId}`, conversationId: `max:${remoteId}`, providerMessageId: messageId,
        senderId, senderName: contactName(contact), senderAvatarDataUrl: avatarUrl(contact),
        direction: senderId === selfId ? 'outgoing' : 'incoming',
        text: typeof content.text === 'string' ? content.text : '',
        createdAt: number(raw.time), editedAt: raw.status === 'EDITED' ? number(raw.updateTime) || null : null,
        ...(senderId === selfId ? { deliveryStatus: 'sent' as const } : {}),
        media: attachments(raw).map(normalizeMedia), reactions: reactions(raw.reactionInfo),
        ...(links.length ? { textLinks: links } : {}),
        ...(link.type === 'REPLY' && id(link.messageId ?? reply.id) ? {
            replyToProviderMessageId: id(link.messageId ?? reply.id)!,
            replyToText: typeof reply.text === 'string' ? reply.text : undefined,
            replyToSenderName: contactName(contacts.get(id(reply.sender) ?? '') ?? {}) ?? undefined
        } : {}),
        ...(link.type === 'FORWARD' ? { forward: {
            sourceName: typeof link.chatName === 'string' ? link.chatName : null,
            sourceUrl: typeof link.chatLink === 'string' ? link.chatLink : undefined
        } } : {})
    }
}

export function normalizeConversation(raw: MaxObject, selfId: string, contacts: Map<string, MaxObject>): ExternalConversation | null {
    const remoteId = id(raw.id)
    if (!remoteId || !['DIALOG', 'CHAT', 'CHANNEL', 'SELF'].includes(String(raw.type)) || raw.status === 'REMOVED') return null
    const peerId = Object.keys(object(raw.participants)).find(participant => participant !== selfId)
    const peer = contacts.get(peerId ?? '') ?? {}
    const last = object(raw.lastMessage)
    const outgoing = id(last.sender) === selfId
    const saved = raw.type === 'SELF' || (remoteId === '0' && raw.type === 'DIALOG' && !peerId)
    const title = typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim()
        : contactName(peer) ?? (saved ? 'Saved messages' : `MAX ${remoteId}`)
    return {
        id: `max:${remoteId}`, provider: 'max', remoteId, title,
        kind: saved ? 'saved' : raw.type === 'CHAT' ? 'group' : raw.type === 'CHANNEL' ? 'channel' : 'direct',
        selected: false, lastMessageAt: number(last.time) || null,
        lastMessagePreview: typeof last.text === 'string' && last.text ? last.text
            : attachments(last).length ? 'Attachment' : null,
        lastMessageDirection: last.time ? outgoing ? 'outgoing' : 'incoming' : null,
        lastMessageDeliveryStatus: outgoing ? 'sent' : null,
        unreadCount: Math.max(0, Math.trunc(number(raw.newMessages ?? raw.unread))),
        avatarDataUrl: avatarUrl(raw) ?? avatarUrl(saved ? contacts.get(selfId) ?? {} : peer)
    }
}
