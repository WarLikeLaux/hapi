import { Hono } from 'hono'
import type { SyncEngine } from '../../sync/syncEngine'
import type { WebAppEnv } from '../middleware/auth'

/** Subscription-quota snapshots pushed by runners (GLM / Codex / AGY / Cursor windows). */
export function createQuotasRoutes(getSyncEngine: () => SyncEngine | null): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    app.get('/quotas', (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not connected' }, 503)
        }
        const namespace = c.get('namespace')
        return c.json({ quotas: engine.getQuotasByNamespace(namespace) })
    })

    return app
}
