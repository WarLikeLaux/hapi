import { Hono } from 'hono'
import { z } from 'zod'
import type { Store } from '../../store'
import type { WebAppEnv } from '../middleware/auth'

const projectSchema = z.object({
    machineId: z.string().trim().min(1).max(256),
    path: z.string().trim().min(1).max(4096).refine(path => path.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(path) || path.startsWith('\\\\')),
    alias: z.string().trim().max(80).nullable(),
    section: z.enum(['auto', 'work', 'recent']),
    priority: z.boolean(),
    isDefault: z.boolean(),
    hidden: z.boolean().optional(),
})
const projectsSchema = z.array(projectSchema).max(500)
    .refine(projects => new Set(projects.map(p => JSON.stringify([p.machineId, p.path]))).size === projects.length)
    .refine(projects => projects.filter(p => p.isDefault).length <= 1)
    .refine(projects => projects.every(p => !p.hidden || !p.isDefault))

export function createProjectPreferenceRoutes(store: Store): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()
    app.get('/project-preferences', c => {
        c.header('Cache-Control', 'no-store')
        return c.json({ projects: store.projectPreferences.list(c.get('namespace')) })
    })
    app.put('/project-preferences', async c => {
        const parsed = projectsSchema.safeParse(await c.req.json().catch(() => null))
        if (!parsed.success) return c.json({ error: 'Invalid project preferences' }, 400)
        store.projectPreferences.save(c.get('namespace'), parsed.data)
        c.header('Cache-Control', 'no-store')
        return c.json({ projects: parsed.data })
    })
    return app
}
