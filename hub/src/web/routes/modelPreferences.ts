import { CREATABLE_AGENT_FLAVORS } from '@hapi/protocol'
import { Hono } from 'hono'
import { z } from 'zod'
import type { Store } from '../../store'
import type { WebAppEnv } from '../middleware/auth'

const preferenceSchema = z.object({
    agent: z.string().refine(value => CREATABLE_AGENT_FLAVORS.includes(value as typeof CREATABLE_AGENT_FLAVORS[number])),
    modelId: z.string().trim().min(1).max(256),
    pinned: z.boolean(),
    alias: z.string().trim().max(80).nullable(),
    hidden: z.boolean().optional().default(false),
    reasoningEffort: z.string().trim().min(1).max(64).nullable().optional().default(null)
})

export function createModelPreferenceRoutes(store: Store): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    app.get('/model-preferences', c => {
        c.header('Cache-Control', 'no-store')
        return c.json({ preferences: store.modelPreferences.list(c.get('namespace')) })
    })

    app.put('/model-preferences', async c => {
        const parsed = preferenceSchema.safeParse(await c.req.json().catch(() => null))
        if (!parsed.success) return c.json({ error: 'Invalid model preference' }, 400)
        const preference = store.modelPreferences.save(c.get('namespace'), {
            ...parsed.data,
            alias: parsed.data.alias || null
        })
        c.header('Cache-Control', 'no-store')
        return c.json({ preference })
    })

    app.put('/model-preferences/order', async c => {
        const schema = z.object({
            agent: preferenceSchema.shape.agent,
            modelIds: z.array(z.string().trim().min(1).max(256)).max(500)
                .refine(ids => new Set(ids).size === ids.length)
        })
        const parsed = schema.safeParse(await c.req.json().catch(() => null))
        if (!parsed.success) return c.json({ error: 'Invalid model order' }, 400)
        store.modelPreferences.reorder(c.get('namespace'), parsed.data.agent, parsed.data.modelIds)
        return c.json({ preferences: store.modelPreferences.list(c.get('namespace')) })
    })

    return app
}
