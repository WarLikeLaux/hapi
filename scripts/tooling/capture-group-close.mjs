#!/usr/bin/env bun
// Production UI and navigation; isolated REST/SSE fixtures emulate manual archive and agent self-close.
// HAPI_GROUP_PREVIEW=http://127.0.0.1:5176 bun scripts/tooling/capture-group-close.mjs
import { expect } from '@playwright/test'
import { captureHapiUi } from './hapi-ui.mjs'

const origin = process.env.HAPI_GROUP_PREVIEW ?? 'http://127.0.0.1:5176'
const at = Date.now() - 60_000
const modes = process.argv.length > 2 ? process.argv.slice(2) : ['manual', 'self', 'empty']
for (const width of [1440, 390]) for (const mode of modes) {
    const names = ['План работ', 'Требуется ответ', 'Завершаемый чат', 'Непрочитанный результат']
    let sessions = names.map((name, i) => ({
        id: `close-${i}`, namespace: 'default', seq: 1, active: true, thinking: false, thinkingAt: 0,
        activeAt: at, createdAt: at, updatedAt: at, lastAgentMessageAt: at,
        metadata: { path: '/demo/hapi', host: 'preview', name, flavor: 'codex', lifecycleState: 'running' },
        metadataVersion: 1, agentStateVersion: 1, agentState: {},
        pendingRequestKinds: [], pendingRequests: [], pendingRequestsCount: 0,
        backgroundTaskCount: 0, todoProgress: null, todosUpdatedAt: 0, model: null, effort: null,
    }))
    const group = { id: 'close-group', name: 'HAPI · пример закрытия', version: 1, updatedAt: at,
        members: sessions.map((session, i) => ({ sessionId: session.id, pinned: i === 0 })) }
    const messages = new Map(sessions.map(s => [s.id, [{
        id: `${s.id}-first`, seq: 1, localId: null, createdAt: at,
        content: { role: 'user', content: { type: 'text', text: `Переписка: ${s.metadata.name}` } },
    }]]))
    let page
    const emit = event => page.evaluate(event => window.__emitGroupPreview(event), event)
    const update = async (id, patch) => {
        sessions = sessions.map(s => s.id === id ? { ...s, ...patch } : s)
        await emit({ type: 'session-updated', sessionId: id, data: sessions.find(s => s.id === id) })
    }
    const archive = async (id, self = false) => {
        // Membership can arrive first. The UI must retain the original group until archive is observed.
        group.members = group.members.filter(m => m.sessionId !== id)
        group.version++
        const refreshed = page.waitForResponse(response => new URL(response.url()).pathname === '/api/groups')
        await emit({ type: 'groups-updated', namespace: 'default' })
        await refreshed
        const current = sessions.find(s => s.id === id)
        await update(id, { active: false, metadataVersion: current.metadataVersion + 1,
            metadata: { ...current.metadata, lifecycleState: 'archived', archivedBy: self ? 'cli' : 'hub',
                ...(self ? { readThrough: current.lastAgentMessageAt } : {}) } })
    }
    const result = await captureHapiUi({
        url: `${origin}/sessions/close-2`, width, height: width === 390 ? 844 : 960,
        out: `/tmp/hapi-close-${width === 390 ? 'mobile' : 'wide'}-${mode}.png`,
        expect: mode === 'empty' ? 'text=No chats in this group yet.'
            : `[role="tab"][aria-selected="true"] > span:has-text("${mode === 'manual' ? 'Требуется ответ' : 'Непрочитанный результат'}")`,
        prepare: async prepared => {
            page = prepared
            await page.addInitScript(() => {
                for (const feature of ['scratchlist-toggle', 'rich-composer-mentions']) localStorage.setItem(`hapi.fue.v1.${feature}`, '1')
                // Emulate only the event transport; useSSE applies real production patches and invalidations.
                const sources = new Set()
                window.EventSource = class {
                    static OPEN = 1
                    static CLOSED = 2
                    readyState = 1
                    constructor(url) {
                        this.url = new URL(url, location.href)
                        sources.add(this)
                        queueMicrotask(() => {
                            this.onopen?.(new Event('open'))
                            this.onmessage?.(new MessageEvent('message', { data: JSON.stringify({
                                type: 'connection-changed', data: { resume: 'ok' },
                            }) }))
                        })
                    }
                    close() { this.readyState = 2; sources.delete(this) }
                }
                window.__emitGroupPreview = event => {
                    for (const source of sources) {
                        if (!event.sessionId || source.url.searchParams.get('all') === 'true'
                            || source.url.searchParams.get('sessionId') === event.sessionId) {
                            source.onmessage?.(new MessageEvent('message', { data: JSON.stringify(event) }))
                        }
                    }
                }
            })
            await page.route(url => url.pathname.startsWith('/api/'), async route => {
                const path = new URL(route.request().url()).pathname
                const json = body => route.fulfill({ json: body })
                if (path.startsWith('/api/auth')) return route.continue()
                if (path === '/api/sessions') return json({ sessions })
                if (path === '/api/groups') return json({ groups: [group] })
                if (path === '/api/machines') return json({ machines: [] })
                if (path === '/api/conversations') return json({ conversations: [] })
                if (path === '/api/hub-settings') return json({})
                if (path === '/api/quotas') return json({ quotas: [] })
                if (path === '/api/health') return json({ ok: true })
                if (path === '/api/voice/backend') return json({ backend: null, backends: [] })
                if (path === '/api/voice/transcription/providers') return json({ providers: [] })
                const match = path.match(/^\/api\/sessions\/([^/]+)(.*)$/)
                if (match) {
                    const [, id, suffix] = match
                    if (!suffix) return json({ session: sessions.find(s => s.id === id) })
                    if (suffix === '/archive') { await archive(id); return json({ ok: true }) }
                    if (suffix === '/messages') return json({ messages: messages.get(id), page: {
                        direction: 'latest', limit: 200, epoch: 0, reset: false, hasMore: false,
                        nextBeforeSeq: null, nextBeforeAt: null, nextAfterSeq: null, nextAfterAt: null, snapshotHeadSeq: messages.get(id).length, snapshotHeadAt: at,
                    } })
                    if (suffix === '/scratchlist') return json({ entries: [] })
                    if (suffix === '/slash-commands') return json({ success: true, commands: [] })
                    if (suffix === '/skills') return json({ success: true, skills: [] })
                    if (suffix === '/codex-models') return json({ success: true, models: [] })
                    if (suffix === '/git-status') return json({ success: true, files: [], branch: 'demo' })
                }
                throw new Error(`Missing preview API fixture for ${path}`)
            })
        },
        interact: async () => {
            const current = page.getByRole('tab').filter({ hasText: 'Завершаемый чат' })
            await expect(current).toHaveAttribute('aria-selected', 'true')
            await expect(page.getByText('Переписка: Завершаемый чат', { exact: true })).toBeVisible()
            // A transient disconnect must not count as closure, nor may closing another tab steal this chat.
            await update('close-2', { active: false })
            await expect(current).toHaveAttribute('aria-selected', 'true')
            await update('close-2', { active: true })
            await archive('close-0')
            await expect(current).toHaveAttribute('aria-selected', 'true')
            if (mode === 'manual') {
                await update('close-1', { pendingRequestKinds: ['input'], pendingRequestsCount: 1,
                    agentState: { requests: { q: { tool: 'AskUserQuestion', createdAt: at,
                        arguments: { questions: [{ header: 'Проверка', question: 'Продолжить проверку изменений?',
                            options: [{ label: 'Продолжить' }, { label: 'Остановиться' }], multiSelect: false }] },
                    } } } })
                await update('close-3', { lastAgentMessageAt: at + 100 })
                await page.getByRole('button', { name: 'More actions', exact: true }).click()
                await page.getByRole('menuitem', { name: 'Stop session', exact: true }).click()
                const dialog = page.getByRole('dialog')
                await dialog.getByRole('button', { name: 'Stop session', exact: true }).click()
            } else {
                if (mode === 'empty') {
                    await archive('close-1')
                    await archive('close-3')
                } else await update('close-3', { lastAgentMessageAt: at + 100 })
                const final = { id: 'final-answer', seq: 2, localId: null, createdAt: at + 200,
                    content: { role: 'agent', content: { type: 'codex', data: { type: 'message', message: 'Финальный ответ перед закрытием сохранён.' } } } }
                messages.get('close-2').push(final)
                await emit({ type: 'message-received', sessionId: 'close-2', message: final })
                await update('close-2', { lastAgentMessageAt: final.createdAt })
                await expect(page.getByText('Финальный ответ перед закрытием сохранён.', { exact: true })).toBeVisible()
                await expect(current).toHaveAttribute('aria-selected', 'true')
                await archive('close-2', true)
            }
            if (mode === 'empty') {
                await expect(page).toHaveURL(`${origin}/sessions/groups/close-group`)
                await expect(page.getByRole('tablist', { name: 'Group chats' })).toHaveCount(0)
            } else {
                await expect(page.getByRole('tab').filter({ hasText: mode === 'manual' ? 'Требуется ответ' : 'Непрочитанный результат' })).toHaveAttribute('aria-selected', 'true')
                await expect(page.getByRole('tab').filter({ hasText: 'Завершаемый чат' })).toHaveCount(0)
            }
            if (mode !== 'manual') {
                // Explicit archived-history links remain readable, including the final answer.
                const destination = page.url()
                await page.goto(`${origin}/sessions/close-2`)
                await expect(page.getByText('Финальный ответ перед закрытием сохранён.', { exact: true })).toBeVisible()
                await expect(page).toHaveURL(`${origin}/sessions/close-2`)
                await page.goto(destination)
            } else {
                await expect.poll(() => page.evaluate(async () => {
                    const { getSessionLastSeenAt } = await import('/src/lib/sessionLastSeen.ts')
                    return getSessionLastSeenAt('close-3')
                })).toBe(at)
            }
        },
    })
    console.log(JSON.stringify(result))
}
