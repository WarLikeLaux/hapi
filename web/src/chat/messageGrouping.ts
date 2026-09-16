import type { ExternalMessage } from '@hapi/protocol'

function isSameLocalDay(left: number, right: number): boolean {
    const leftDate = new Date(left)
    const rightDate = new Date(right)
    return leftDate.getFullYear() === rightDate.getFullYear()
        && leftDate.getMonth() === rightDate.getMonth()
        && leftDate.getDate() === rightDate.getDate()
}

export function areExternalMessagesGrouped(
    previous: ExternalMessage | undefined,
    current: ExternalMessage | undefined
): boolean {
    if (!previous || !current || previous.direction !== current.direction) return false
    if (previous.senderId !== current.senderId) return false
    if (!previous.senderId && previous.senderName !== current.senderName) return false

    return current.createdAt >= previous.createdAt
        && isSameLocalDay(previous.createdAt, current.createdAt)
}
