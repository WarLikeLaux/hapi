import { Hono } from 'hono'
import { z } from 'zod'
import { existsSync, mkdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import type { SyncEngine } from '../../sync/syncEngine'
import type { WebAppEnv } from '../middleware/auth'
import { requireSessionFromParam, requireSyncEngine } from './guards'

// Mailbox shared with the local editor opener (e.g. the code-local VS Code
// extension watches <dir>/requests/). Overridable for tests via
// HAPI_EDITOR_MAILBOX_DIR; must match the opener's directory in production.
export function editorMailboxDir(): string {
    const override = process.env.HAPI_EDITOR_MAILBOX_DIR?.trim()
    if (override) return override
    return join(homedir(), '.local', 'share', 'code-local', 'hapi-open')
}

const DEFAULT_CLAIM_WAIT_MS = 5000
const CLAIM_POLL_MS = 100

function claimWaitMs(): number {
    const raw = Number(process.env.HAPI_EDITOR_CLAIM_WAIT_MS)
    return Number.isSafeInteger(raw) && raw >= 0 ? raw : DEFAULT_CLAIM_WAIT_MS
}

const openSchema = z.object({
    path: z.string().min(1).max(4096),
    line: z.number().int().min(1).max(1000000).optional(),
    column: z.number().int().min(1).max(1000000).optional()
})

function insideRoot(file: string, root: string): boolean {
    const cleanRoot = resolve(root)
    const cleanFile = resolve(cleanRoot, file)
    return cleanFile === cleanRoot || cleanFile.startsWith(cleanRoot + '/')
}

function isRegularFile(file: string): boolean {
    try {
        return statSync(file).isFile()
    } catch {
        return false
    }
}

async function waitForClaim(requestsDir: string, id: string): Promise<boolean> {
    const file = join(requestsDir, id + '.json')
    const deadline = Date.now() + claimWaitMs()
    for (;;) {
        if (!existsSync(file)) return true
        if (Date.now() >= deadline) return false
        await new Promise((resolveSleep) => setTimeout(resolveSleep, CLAIM_POLL_MS))
    }
}

export function createEditorRoutes(getSyncEngine: () => SyncEngine | null): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    // Ask the local editor (watching the mailbox) to open a session file.
    // 200 { opened: true } — an editor window claimed the request.
    // 404 { error: 'no-window' } — no window holds this project; the client
    // should fall back to opening a new editor tab for the session root.
    app.post('/sessions/:id/editor-open', async (c) => {
        const engineOrResponse = requireSyncEngine(c, getSyncEngine)
        if (engineOrResponse instanceof Response) return engineOrResponse
        const sessionOrResponse = requireSessionFromParam(c, engineOrResponse)
        if (sessionOrResponse instanceof Response) return sessionOrResponse
        const { session } = sessionOrResponse

        const json = await c.req.json().catch(() => null)
        const parsed = openSchema.safeParse(json)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body', issues: parsed.error.flatten() }, 400)
        }

        const root = session.metadata?.worktree?.worktreePath ?? session.metadata?.path ?? null
        if (typeof root !== 'string' || root.length === 0) {
            return c.json({ error: 'Session has no workspace', code: 'no-workspace' }, 409)
        }
        const { path: file, line, column } = parsed.data
        if (!file.startsWith('/') || !insideRoot(file, root)) {
            return c.json({ error: 'Path is outside the session workspace', code: 'outside-workspace' }, 400)
        }
        if (!isRegularFile(file)) {
            return c.json({ error: 'File not found', code: 'file-not-found' }, 404)
        }

        const base = editorMailboxDir()
        const requestsDir = join(base, 'requests')
        try {
            mkdirSync(requestsDir, { recursive: true })
        } catch {
            return c.json({ error: 'Editor mailbox unavailable', code: 'mailbox-unavailable' }, 500)
        }
        const id = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2).replace(/[^a-z0-9]/g, '')
        try {
            writeFileSync(
                join(requestsDir, id + '.json'),
                JSON.stringify({ file, line, column, ts: Date.now() })
            )
        } catch {
            return c.json({ error: 'Editor mailbox unavailable', code: 'mailbox-unavailable' }, 500)
        }

        const claimed = await waitForClaim(requestsDir, id)
        if (!claimed) {
            try { unlinkSync(join(requestsDir, id + '.json')) } catch { /* swept by TTL */ }
            return c.json({ error: 'No editor window holds this project', code: 'no-window' }, 404)
        }
        return c.json({ opened: true, folder: root })
    })

    return app
}
