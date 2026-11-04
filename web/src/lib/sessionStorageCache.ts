import { storageKey as scrollKey } from '@tanstack/router-core'

const MESSAGE_PREFIX = 'hapi:message-window:v3:'
const CACHE_BUDGET = 1024 * 1024

// Message windows are warm copies of hub data, except for local optimistic rows.
// Never discard a snapshot containing one, or an unrecognizable snapshot.
export function disposableMessageWindow(raw: string): boolean {
    try {
        const value = JSON.parse(raw) as { messages?: Array<{ id?: unknown; localId?: unknown }> }
        return Array.isArray(value.messages) && value.messages.every(message =>
            message && typeof message.id === 'string' && !(message.localId && message.id === message.localId))
    } catch { return false }
}

export function trimSessionCaches(storage: Storage, target = CACHE_BUDGET, except?: string): void {
    const entries: Array<{ key: string; size: number }> = []
    let total = 0
    for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i)
        if (!key?.startsWith(MESSAGE_PREFIX)) continue
        const raw = storage.getItem(key)
        if (raw === null) continue
        total += key.length + raw.length
        if (key !== except && disposableMessageWindow(raw)) entries.push({ key, size: key.length + raw.length })
    }
    for (const entry of entries) {
        if (total <= target) break
        storage.removeItem(entry.key)
        total -= entry.size
    }
}

export function saveLaunchReceipt(storage: Storage, key: string, value: string): void {
    try {
        storage.setItem(key, value)
    } catch (error) {
        if (!(error instanceof DOMException) || error.name !== 'QuotaExceededError') throw error
        // Reclaim only reconstructible caches, never drafts or other launch receipts.
        storage.removeItem(scrollKey)
        trimSessionCaches(storage, 0)
        storage.setItem(key, value)
    }
}
