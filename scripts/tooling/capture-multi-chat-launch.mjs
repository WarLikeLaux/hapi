#!/usr/bin/env bun
// Real slot UI, real machine/catalog/path queries. Only group creation and launch
// outcomes are mocked: no real sessions, groups or agent prompts are created.
import { expect } from '@playwright/test'
import { captureHapiUi } from './hapi-ui.mjs'

const origin = process.env.HAPI_PREVIEW_ORIGIN ?? 'http://127.0.0.1:5174'
const commonPrompt = 'Найди причину медленного запуска сессий. Предложи исправление и проверь его целевыми тестами.'
const ownPrompt = 'Проверь только обработку ошибок запуска. Опиши риски повторного создания чатов.'
const captures = [
    { name: 'default-wide', width: 1440, height: 1000, mode: 'single' },
    { name: 'default-mobile', width: 390, height: 844, mode: 'single' },
    { name: 'group-mobile', width: 390, height: 1000, mode: 'single-group' },
    { name: 'return-mobile', width: 390, height: 844, mode: 'return' },
    { name: 'wide', width: 1440, height: 1440, mode: 'overview' },
    { name: 'mobile-settings', width: 390, height: 1000, mode: 'settings' },
    { name: 'mobile', width: 390, height: 844, mode: 'overview' },
    { name: 'mobile-own-project', width: 390, height: 1000, mode: 'own' },
    { name: 'wide-results', width: 1440, height: 1100, mode: 'results' },
    { name: 'mobile-results', width: 390, height: 1200, mode: 'results' },
]
for (const shot of captures.filter(shot => !process.argv[2] || shot.name === process.argv[2])) {
    const requests = []
    console.log(JSON.stringify(await captureHapiUi({
        url: `${origin}/sessions/new?directory=${encodeURIComponent('/home/shandori/code/hapi')}`,
        out: `/tmp/hapi-create-fix-${shot.name}.png`, width: shot.width, height: shot.height,
        expect: ['single', 'single-group', 'return'].includes(shot.mode) ? 'button:has-text("Add another chat")' : shot.mode === 'settings' ? 'button:has-text("Single chat")' : shot.mode === 'own' ? 'article:nth-of-type(2) input[type="text"]'
            : shot.mode === 'results' ? 'text=Launch outcome unknown' : 'button:has-text("Launch 3 chats")',
        prepare: async page => {
            await page.addInitScript(() => {
                sessionStorage.removeItem('hapi:session-composition:standalone')
                localStorage.setItem('hapi-lang', 'en')
            })
            await page.route('**/api/groups', async route => {
                if (route.request().method() !== 'POST') return route.continue()
                await route.fulfill({ json: { group: { id: 'preview-comparison', name: 'Параллельный разбор', members: [], version: 1, updatedAt: Date.now() } } })
            })
            await page.route('**/api/machines/*/launch', async route => {
                const input = route.request().postDataJSON()
                requests.push(input)
                const result = input.agent === 'codex' ? { state: 'succeeded', sessionId: 'preview-codex' }
                    : input.agent === 'claude' ? { state: 'failed', message: 'Runner declined to start this agent (simulated).' }
                    : { state: 'indeterminate', sessionId: 'preview-agy', message: 'Runner response timed out (simulated).' }
                await route.fulfill({ json: result })
            })
        },
        interact: async page => {
            // Development tooling is absent in the shipped app and must not cover prompts.
            await page.addStyleTag({ content: '.tsqd-open-btn-container { display: none !important; }' })
            await expect(page.getByRole('button', { name: 'Create', exact: true })).toBeEnabled()
            await page.locator('input[type="radio"][value="codex"]').check()
            if (shot.mode === 'single' || shot.mode === 'single-group') {
                await expect(page.getByRole('article')).toHaveCount(0)
                await expect(page.getByRole('textbox', { name: 'Shared initial prompt (optional)' })).toHaveCount(0)
                if (shot.mode === 'single-group') {
                    await page.getByRole('checkbox', { name: 'Create a group with this chat' }).check()
                    await page.getByRole('textbox', { name: 'Group name', exact: true }).fill('Параллельный разбор')
                }
                return
            }
            await page.getByRole('button', { name: 'Add another chat', exact: true }).click()
            if (shot.mode === 'return') {
                await page.getByRole('button', { name: 'Single chat', exact: true }).click()
                await expect(page.getByRole('article')).toHaveCount(0)
                await expect(page.getByRole('button', { name: 'Create', exact: true })).toBeEnabled()
                await page.getByRole('button', { name: 'Add another chat', exact: true }).click()
                await page.getByRole('button', { name: 'Cancel', exact: true }).click()
                await expect(page).not.toHaveURL(/sessions\/new/)
                await page.goto(`${origin}/sessions/new?directory=${encodeURIComponent('/home/shandori/code/hapi')}`)
                await expect(page.getByRole('button', { name: 'Create', exact: true })).toBeEnabled()
                await expect(page.getByRole('article')).toHaveCount(0)
                await page.addStyleTag({ content: '.tsqd-open-btn-container { display: none !important; }' })
                return
            }
            await page.getByRole('button', { name: 'Remove chat 2', exact: true }).click()
            await page.getByRole('textbox', { name: 'Shared initial prompt (optional)' }).fill(commonPrompt)
            await page.getByRole('combobox', { name: 'Place chats' }).selectOption('new')
            await page.getByRole('textbox', { name: 'Group name', exact: true }).fill('Параллельный разбор')
            await page.getByRole('button', { name: 'Duplicate 1', exact: true }).click()
            const second = page.getByRole('article').nth(1)
            await second.locator('input[type="radio"][value="claude"]').check()
            await second.getByRole('checkbox', { name: 'Use own prompt' }).check()
            await second.getByRole('textbox', { name: 'Own prompt', exact: true }).fill(ownPrompt)
            await second.getByRole('button', { name: 'Another project', exact: true }).click()
            await second.locator('input[type="text"]').fill('/home/shandori/code/desk')
            await second.locator('input[type="text"]').blur()
            await page.getByRole('button', { name: 'Add chat', exact: true }).click()
            const third = page.getByRole('article').nth(2)
            await third.locator('input[type="radio"][value="agy"]').check()
            await expect(page.getByRole('button', { name: 'Launch 3 chats', exact: true })).toBeEnabled()
            await third.locator('button[aria-expanded]').click()
            if (shot.mode === 'settings') {
                await page.getByRole('button', { name: 'Single chat', exact: true }).scrollIntoViewIfNeeded()
            } else if (shot.mode === 'own') {
                await second.locator('button[aria-expanded]').click()
                await second.getByRole('checkbox', { name: 'Use own prompt' }).evaluate(element => element.scrollIntoView({ block: 'center' }))
            } else if (shot.mode === 'overview') {
                await expect(page.getByText('Exact initial prompt', { exact: true })).toHaveCount(0)
                await expect(second.locator('p').filter({ hasText: ownPrompt })).toBeVisible()
            } else {
                await page.getByRole('button', { name: 'Launch 3 chats', exact: true }).click()
                await expect(page.getByText('1 of 3 chats started')).toBeVisible()
                expect(requests).toHaveLength(3)
                expect(requests.find(input => input.agent === 'codex')).toMatchObject({ directory: '/home/shandori/code/hapi', initialPrompt: commonPrompt, groupId: 'preview-comparison' })
                expect(requests.find(input => input.agent === 'claude')).toMatchObject({ directory: '/home/shandori/code/desk', initialPrompt: ownPrompt, groupId: 'preview-comparison' })
                expect(requests.find(input => input.agent === 'agy')).toMatchObject({ initialPrompt: commonPrompt })
                // Checking the uncertain launch preserves its ID and exact prompt.
                const original = requests.find(input => input.agent === 'agy')
                await third.getByRole('button', { name: 'Check launch', exact: true }).click()
                await expect(third.getByRole('button', { name: 'Check launch', exact: true })).toBeEnabled()
                expect(requests.filter(input => input.agent === 'agy')).toEqual([original, original])
                // Retrying one known failure never repeats successful or uncertain requests.
                await page.getByRole('button', { name: 'Retry failed (1)', exact: true }).click()
                await expect(second.getByRole('button', { name: 'Retry this chat', exact: true })).toBeEnabled()
                const failed = requests.filter(input => input.agent === 'claude')
                expect(failed).toHaveLength(2)
                expect(failed[0].requestId).not.toBe(failed[1].requestId)
                expect(requests.filter(input => input.agent === 'codex')).toHaveLength(1)
            }
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
        },
    })))
}
