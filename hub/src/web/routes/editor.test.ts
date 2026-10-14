import { describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import type { Session, SyncEngine } from '../../sync/syncEngine'
import type { WebAppEnv } from '../middleware/auth'
import { createEditorRoutes } from './editor'

process.env.HAPI_EDITOR_CLAIM_WAIT_MS = '600'

function useMailbox(): string {
    const base = mkdtempSync(join(tmpdir(), 'hapi-editor-test-'))
    process.env.HAPI_EDITOR_MAILBOX_DIR = base
    return base
}

function createSession(overrides?: Partial<Session>): Session {
    return {
        id: 'session-1',
        namespace: 'default',
        seq: 1,
        createdAt: 1,
        updatedAt: 1,
        active: true,
        activeAt: 1,
        metadata: { path: '/tmp/project', host: 'localhost', flavor: 'codex' as const },
        metadataVersion: 1,
        agentState: { controlledByUser: false, requests: {}, completedRequests: {} },
        agentStateVersion: 1,
        thinking: false,
        thinkingAt: 1,
        model: 'gpt-5.4',
        modelReasoningEffort: null,
        effort: null,
        serviceTier: null,
        permissionMode: 'default',
        collaborationMode: 'default',
        ...overrides
    } as Session
}

function withMetadataPath(root: string, extra?: Record<string, unknown>): Session['metadata'] {
    return { path: root, host: 'x', flavor: 'codex', ...extra } as Session['metadata']
}

function createApp(session: Session | null) {
    const engine = {
        resolveSessionAccess: (sessionId: string, namespace: string) => {
            if (!session || sessionId !== session.id || namespace !== session.namespace) {
                return { ok: false as const, reason: 'not-found' as const }
            }
            return { ok: true as const, sessionId: session.id, session }
        }
    }
    const app = new Hono<WebAppEnv>()
    app.use('/api/*', async (c, next) => {
        c.set('namespace', 'default')
        await next()
    })
    app.route('/api', createEditorRoutes(() => engine as unknown as SyncEngine))
    return app
}

function createProject(): string {
    const root = mkdtempSync(join(tmpdir(), 'hapi-editor-project-'))
    mkdirSync(join(root, 'jobs'), { recursive: true })
    writeFileSync(join(root, 'jobs', 'Job.php'), '<?php // job')
    return root
}

function postOpen(app: Hono<WebAppEnv>, body: unknown) {
    return app.request('/api/sessions/session-1/editor-open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    })
}

describe('POST /api/sessions/:id/editor-open', () => {
    it('returns 404 when the session does not exist', async () => {
        useMailbox()
        const app = createApp(null)
        const response = await app.request('/api/sessions/missing/editor-open', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: '/tmp/project/a.php' })
        })
        expect(response.status).toBe(404)
    })

    it('rejects paths outside the session workspace', async () => {
        useMailbox()
        const root = createProject()
        const app = createApp(createSession({ metadata: withMetadataPath(root) }))
        for (const bad of [join(root, '..', 'evil.php'), '/etc/passwd', 'relative.php']) {
            const response = await postOpen(app, { path: bad })
            expect(response.status).toBe(400)
        }
    })

    it('returns 404 file-not-found for missing files inside the workspace', async () => {
        useMailbox()
        const root = createProject()
        const app = createApp(createSession({ metadata: withMetadataPath(root) }))
        const response = await postOpen(app, { path: join(root, 'nope.php') })
        expect(response.status).toBe(404)
        expect((await response.json()) as { code?: string }).toMatchObject({ code: 'file-not-found' })
    })

    it('returns no-window when nobody claims the request', async () => {
        useMailbox()
        const root = createProject()
        const app = createApp(createSession({ metadata: withMetadataPath(root) }))
        const response = await postOpen(app, { path: join(root, 'jobs', 'Job.php'), line: 3 })
        expect(response.status).toBe(404)
        expect((await response.json()) as { code?: string }).toMatchObject({ code: 'no-window' })
    })

    it('returns opened when an editor claims the request', async () => {
        const mailbox = useMailbox()
        const root = createProject()
        const app = createApp(createSession({ metadata: withMetadataPath(root) }))
        const file = join(root, 'jobs', 'Job.php')
        // Simulate the editor watcher: claim the first request file that appears.
        const claimer = (async () => {
            const requestsDir = join(mailbox, 'requests')
            const deadline = Date.now() + 4000
            for (;;) {
                try {
                    for (const name of readdirSync(requestsDir)) {
                        if (!name.endsWith('.json')) continue
                        const parsed = JSON.parse(readFileSync(join(requestsDir, name), 'utf8'))
                        expect(parsed.file).toBe(file)
                        expect(parsed.line).toBe(3)
                        rmSync(join(requestsDir, name))
                        return
                    }
                } catch { /* not written yet */ }
                if (Date.now() >= deadline) throw new Error('request never appeared')
                await new Promise((r) => setTimeout(r, 25))
            }
        })()
        const [response] = await Promise.all([
            postOpen(app, { path: file, line: 3 }),
            claimer
        ])
        expect(response.status).toBe(200)
        expect((await response.json()) as { opened?: boolean }).toMatchObject({ opened: true })
    })

    it('prefers the session worktree path over the base path', async () => {
        useMailbox()
        const root = createProject()
        const worktree = createProject()
        const app = createApp(createSession({
            metadata: withMetadataPath(root, { worktree: { worktreePath: worktree } })
        }))
        const response = await postOpen(app, { path: join(root, 'jobs', 'Job.php') })
        expect(response.status).toBe(400)
        expect((await response.json()) as { code?: string }).toMatchObject({ code: 'outside-workspace' })
    })
})
