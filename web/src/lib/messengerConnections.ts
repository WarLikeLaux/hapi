import type { MessengerConnection } from '@hapi/protocol/messengers'

export function upsertMessengerConnection(
    current: readonly MessengerConnection[] | undefined,
    next: MessengerConnection
): MessengerConnection[] {
    if (!current) return [next]
    const index = current.findIndex((item) => item.provider === next.provider)
    if (index < 0) return [...current, next]
    return current.map((item, itemIndex) => itemIndex === index ? next : item)
}
