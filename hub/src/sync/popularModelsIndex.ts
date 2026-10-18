import type { Store } from '../store'
import { collectUsageEventBatches, getPopularModels } from './usageService'

/** New messages maintain the index eagerly; only legacy history needs a backfill. */
export class PopularModelsIndex {
    private readonly refreshing = new Map<string, Promise<void>>()

    constructor(private readonly store: Store) {}

    get(namespace: string) {
        if (!this.refreshing.has(namespace)) {
            const pending = this.store.usage.getPendingSessionIds(namespace)
            if (!pending.length) return getPopularModels(this.store, namespace)
            const refresh = new Promise<void>(resolve => setTimeout(resolve, 0)).then(async () => {
                const sessions = pending.flatMap(id => this.store.sessions.getSession(id) ?? [])
                for (const _batch of collectUsageEventBatches(this.store, sessions)) {
                    await new Promise<void>(resolve => setTimeout(resolve, 0))
                }
            }).catch(() => {
                console.warn('[Hub] Could not backfill model usage; serving the persisted index')
            }).finally(() => { this.refreshing.delete(namespace) })
            this.refreshing.set(namespace, refresh)
        }
        return getPopularModels(this.store, namespace)
    }
}
