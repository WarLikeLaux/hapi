import { Hono } from 'hono'
import { z } from 'zod'
import type { Store } from '../../store'
import type { WebAppEnv } from '../middleware/auth'

const titlesSchema = z.object({
    work: z.string().trim().min(1).max(120),
    regular: z.string().trim().min(1).max(120),
}).strict()

export function createBrowserTitleRoutes(store: Store): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()
    app.get('/browser-titles', c => {
        c.header('Cache-Control', 'no-store')
        return c.json(store.browserTitles.get(c.get('namespace')))
    })
    app.put('/browser-titles', async c => {
        const parsed = titlesSchema.safeParse(await c.req.json().catch(() => null))
        if (!parsed.success) return c.json({ error: 'Invalid browser titles' }, 400)
        c.header('Cache-Control', 'no-store')
        return c.json(store.browserTitles.save(c.get('namespace'), parsed.data))
    })
    return app
}
