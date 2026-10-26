import { Hono } from 'hono'
import type { UsageSummaryResponse } from '@hapi/protocol/apiTypes'
import type { WebAppEnv } from '../middleware/auth'
import type { Store } from '../../store'
import { getUsageSummary } from '../../sync/usageService'
import { PopularModelsIndex } from '../../sync/popularModelsIndex'

export function createUsageRoutes(store: Store): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()
    const popularModels = new PopularModelsIndex(store)

    app.get('/usage/popular-models', c => {
        c.header('Cache-Control', 'no-store')
        return c.json(popularModels.get(c.get('namespace')))
    })

    app.get('/usage/summary', (c) => {
        if (c.get('namespace') !== 'default') {
            return c.json({ error: 'Usage summary is only available to the hub owner' }, 403)
        }
        const range = c.req.query('range')
        const sessionId = c.req.query('sessionId')
        if (sessionId !== undefined && !store.sessions.getSessionByNamespace(sessionId, c.get('namespace'))) {
            return c.json({ error: 'Session not found' }, 404)
        }
        const timeZone = c.req.query('timeZone') ?? 'UTC'
        if (timeZone.length > 100) {
            return c.json({ error: 'Invalid timeZone' }, 400)
        }
        try {
            new Intl.DateTimeFormat('en-US', { timeZone })
        } catch {
            return c.json({ error: 'Invalid timeZone' }, 400)
        }
        const response: UsageSummaryResponse = getUsageSummary(store, c.get('namespace'), range, timeZone, sessionId)
        c.header('Cache-Control', 'no-store')
        return c.json(response)
    })

    return app
}
