#!/usr/bin/env bun
// Real app navigation with isolated API fixtures; never changes live hub chats.
// Run with a slot preview: HAPI_GROUP_PREVIEW=http://127.0.0.1:5175 bun scripts/tooling/capture-group-return.mjs
import { expect } from '@playwright/test'
import { captureHapiUi } from './hapi-ui.mjs'

const origin = process.env.HAPI_GROUP_PREVIEW ?? 'http://127.0.0.1:5175'
const activityAt = Date.now() - 60_000
const titles = ['План работ', 'Архитектура', 'API', 'Тесты', 'Документация', 'Сборка', 'Мобильный клиент', 'Последний просмотренный']
const chat = (id, name) => ({
    id, active: true, thinking: false, activeAt: activityAt, createdAt: activityAt, updatedAt: activityAt,
    lastAgentMessageAt: activityAt, lastUserMessageAt: 0, metadataVersion: 1, agentStateVersion: 1,
    metadata: { path: '/demo/hapi', name, flavor: 'codex', lifecycleState: 'running' },
    namespace: 'default', seq: 1, agentState: {}, thinkingAt: 0,
    pendingRequestKinds: [], pendingRequests: [], pendingRequestsCount: 0, pendingAsyncQuestionsCount: 0,
    backgroundTaskCount: 0, todoProgress: null, todosUpdatedAt: 0, model: null, effort: null,
})

for (const width of [1440, 390]) {
    for (const attention of [false, true]) {
        let sessions = [...titles.map((name, i) => chat(`demo-a-${i}`, name)), chat('demo-b-0', 'Другой проект'), chat('demo-b-1', 'Заметки проекта')]
        const groups = [
            { id: 'demo-a', name: 'HAPI · пример', version: 1, updatedAt: 100,
                members: titles.map((_, i) => ({ sessionId: `demo-a-${i}`, pinned: i === 0 })) },
            { id: 'demo-b', name: 'Вторая группа · пример', version: 1, updatedAt: 100,
                members: [0, 1].map(i => ({ sessionId: `demo-b-${i}`, pinned: false })) },
            { id: 'demo-empty', name: 'Пустая группа · пример', version: 1, updatedAt: 100, members: [] },
        ]
        const output = `/tmp/hapi-group-${width === 390 ? 'mobile' : 'wide'}-${attention ? 'question' : 'remembered'}.png`
        const result = await captureHapiUi({
            url: `${origin}/sessions`, out: output, width, height: width === 390 ? 844 : 960,
            expect: `[role="tab"][aria-selected="true"] > span:has-text("${attention ? 'Архитектура' : 'Последний просмотренный'}")`,
            prepare: async page => {
                page.on('pageerror', error => console.error(error.message))
                await page.addInitScript(() => {
                    for (const feature of ['scratchlist-toggle', 'rich-composer-mentions']) {
                        localStorage.setItem(`hapi.fue.v1.${feature}`, '1')
                    }
                })
                await page.route(url => url.pathname.startsWith('/api/'), async route => {
                    const path = new URL(route.request().url()).pathname
                    if (path.startsWith('/api/auth')) return route.continue()
                    const json = body => route.fulfill({ json: body })
                    if (path === '/api/events') return route.fulfill({ contentType: 'text/event-stream', body: ': isolated fixture\n\n' })
                    if (path === '/api/sessions') return json({ sessions })
                    if (path === '/api/groups') return json({ groups })
                    if (path === '/api/machines') return json({ machines: [] })
                    const match = path.match(/^\/api\/sessions\/([^/]+)(.*)$/)
                    if (match) {
                        const session = sessions.find(s => s.id === match[1])
                        if (!match[2]) return session ? json({ session }) : route.fulfill({ status: 404, json: { error: 'Session not found' } })
                        if (match[2] === '/messages') return json({ messages: [{
                            id: `${session.id}-message`, seq: 1, localId: null, createdAt: activityAt,
                            content: { role: 'user', content: { type: 'text', text: `Пример переписки: ${session.metadata.name}. Проверка возврата в группу.` } },
                        }], page: { direction: 'latest', limit: 200, epoch: 0, reset: false, hasMore: false,
                            nextBeforeSeq: null, nextBeforeAt: null, nextAfterSeq: null, nextAfterAt: null, snapshotHeadSeq: 1, snapshotHeadAt: 100 } })
                        if (match[2] === '/skills') return json({ success: true, skills: [] })
                        if (match[2] === '/scratchlist') return json({ entries: [] })
                        if (match[2] === '/codex-models') return json({ success: true, models: [] })
                        if (match[2] === '/slash-commands') return json({ success: true, commands: [] })
                        if (match[2] === '/git-status') return json({ success: true, files: [], branch: 'demo' })
                    }
                    if (path === '/api/health') return json({ ok: true })
                    if (path === '/api/hub-settings') return json({})
                    if (path === '/api/quotas') return json({ quotas: [] })
                    if (path === '/api/voice/backend') return json({ backend: null, backends: [] })
                    if (path === '/api/voice/transcription/providers') return json({ providers: [] })
                    if (path === '/api/conversations') return json({ conversations: [] })
                    throw new Error(`Missing API fixture for ${path}`)
                })
            },
            interact: async page => {
                const tab = name => page.getByRole('tab').filter({ hasText: name })
                const assertSelected = async name => {
                    await expect(tab(name)).toHaveAttribute('aria-selected', 'true')
                    // Assert visibility before captureHapiUi's final scroll can hide a scrolling bug.
                    // Permit subpixel scroll rounding at the border; the label must fit completely.
                    await expect(tab(name)).toBeInViewport({ ratio: 0.99 })
                    await expect(tab(name).locator('span').first()).toBeInViewport({ ratio: 1 })
                    await expect(page.getByText(`Пример переписки: ${name}. Проверка возврата в группу.`, { exact: true })).toBeVisible()
                }
                const open = async name => page.getByTestId('session-group-row').filter({ hasText: name }).click()
                const leave = async () => {
                    if (width === 390) await page.getByRole('button', { name: 'All sessions', exact: true }).click()
                    else await page.getByRole('link', { name: /^Agents/ }).click()
                    await expect(page.getByTestId('session-group-row').first()).toBeVisible()
                }
                const refresh = async () => page.evaluate(async () => {
                    const { queryClient } = await import('/src/lib/query-client.ts')
                    await Promise.all([
                        queryClient.invalidateQueries({ queryKey: ['sessions'] }),
                        queryClient.invalidateQueries({ queryKey: ['session-groups'] }),
                    ])
                })
                await open('HAPI · пример')
                await assertSelected('План работ')
                await tab('Последний просмотренный').click()
                await assertSelected('Последний просмотренный')
                await leave()
                await open('HAPI · пример')
                await assertSelected('Последний просмотренный')
                await page.reload()
                await assertSelected('Последний просмотренный')
                await leave()
                await open('HAPI · пример')
                await assertSelected('Последний просмотренный')
                if (!attention) return

                // Each group remembers its own actual viewed chat.
                await leave()
                await open('Вторая группа · пример')
                await assertSelected('Другой проект')
                await tab('Заметки проекта').click()
                await leave()
                await open('HAPI · пример')
                await assertSelected('Последний просмотренный')
                await leave()
                await open('Вторая группа · пример')
                await assertSelected('Заметки проекта')
                await leave()
                await open('HAPI · пример')
                await assertSelected('Последний просмотренный')

                // A stale remembered ID must never leave a broken selected tab.
                const last = sessions.find(s => s.id === 'demo-a-7')
                for (const unavailable of ['deleted', 'archived', 'moved']) {
                    await leave()
                    if (unavailable === 'deleted') sessions = sessions.filter(s => s.id !== last.id)
                    if (unavailable === 'archived') sessions = sessions.map(s => s.id === last.id
                        ? { ...s, metadata: { ...s.metadata, lifecycleState: 'archived' } } : s)
                    if (unavailable === 'moved') groups[0].members = groups[0].members.filter(m => m.sessionId !== last.id)
                    await refresh()
                    await open('HAPI · пример')
                    await assertSelected('План работ')
                    await expect(tab('Последний просмотренный')).toHaveCount(0)
                    sessions = [...sessions.filter(s => s.id !== last.id), last]
                    if (unavailable === 'moved') groups[0].members.push({ sessionId: last.id, pinned: false })
                    await refresh()
                    await tab('Последний просмотренный').click()
                    await assertSelected('Последний просмотренный')
                }
                await leave()
                await page.locator('[title="Recent sessions"][aria-expanded="false"]').click()
                await open('Пустая группа · пример')
                await expect(page.getByText('No chats in this group yet.', { exact: false })).toBeVisible()
                await expect(page.getByRole('tablist', { name: 'Group chats' })).toHaveCount(0)
                await leave()
                await open('HAPI · пример')
                await assertSelected('Последний просмотренный')

                // Unread changes do not steal the current chat. Only the opened chat becomes read.
                sessions = sessions.map(s => s.id === 'demo-a-0' ? { ...s, lastAgentMessageAt: activityAt + 200 }
                    : s.id === 'demo-a-2' ? { ...s, lastAgentMessageAt: activityAt + 300 } : s)
                await refresh()
                await assertSelected('Последний просмотренный')
                await leave()
                await open('HAPI · пример')
                await assertSelected('План работ')
                await expect.poll(() => page.evaluate(async () => {
                    const { getSessionLastSeenAt } = await import('/src/lib/sessionLastSeen.ts')
                    return [getSessionLastSeenAt('demo-a-0'), getSessionLastSeenAt('demo-a-2')]
                })).toEqual([activityAt + 200, activityAt])
                await leave()
                await open('HAPI · пример')
                await assertSelected('API')
                await tab('Последний просмотренный').click()

                // Questions outrank a pinned unread chat and a permission; tab order breaks ties.
                sessions = sessions.map(s => s.id === 'demo-a-0' ? { ...s, lastAgentMessageAt: activityAt + 400 }
                    : s.id === 'demo-a-1' || s.id === 'demo-a-2' ? { ...s, pendingRequestKinds: ['input'], pendingRequestsCount: 1 }
                    : s.id === 'demo-a-3' ? { ...s, pendingRequestKinds: ['permission'], pendingRequestsCount: 1 } : s)
                await refresh()
                await assertSelected('Последний просмотренный')
                await tab('Сборка').click()
                await assertSelected('Сборка')
                // Direct session links must win even while other tabs need attention.
                await page.goto(`${origin}/sessions/demo-a-6`)
                await assertSelected('Мобильный клиент')
                await leave()
                await open('HAPI · пример')
                await assertSelected('Архитектура')
            },
        })
        console.log(JSON.stringify(result))
    }
}
