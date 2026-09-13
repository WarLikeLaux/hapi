export function isReadySessionEventContent(value: unknown): boolean {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false
    const envelope = value as Record<string, unknown>
    const payload = envelope.content
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false
    const content = payload as Record<string, unknown>
    const data = content.data
    return content.type === 'event'
        && Boolean(data && typeof data === 'object' && !Array.isArray(data) && (data as Record<string, unknown>).type === 'ready')
}
