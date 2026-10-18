#!/usr/bin/env bun
// Real slot UI, real machine/catalog/path queries. Only group creation and launch
// outcomes are mocked: no real sessions, groups or agent prompts are created.
import { expect } from '@playwright/test'
import { captureHapiUi } from './hapi-ui.mjs'

const origin = process.env.HAPI_PREVIEW_ORIGIN ?? 'http://127.0.0.1:5174'
const commonTask = 'Найди причину медленного запуска сессий. Предложи исправление и проверь его целевыми тестами.'
const ownTask = 'Проверь только обработку ошибок запуска. Опиши риски повторного создания чатов.'
const captures = [
    { name: 'single-prompt-failure', width: 390, height: 1000, mode: 'single-prompt-result', dark: true },
    { name: 'single-prompt-wide', width: 1440, height: 1100, mode: 'single-prompt', dark: true },
    { name: 'single-prompt-mobile', width: 390, height: 1000, mode: 'single-prompt', dark: true },
    { name: 'long-prompts-wide', width: 1440, height: 1100, mode: 'overview', dark: true, longPrompts: true },
    { name: 'long-prompts-mobile', width: 390, height: 900, mode: 'overview', dark: true, longPrompts: true },
    { name: 'expanded-prompt-wide', width: 1440, height: 1100, mode: 'expanded', dark: true, longPrompts: true },
    { name: 'expanded-prompt-mobile', width: 390, height: 900, mode: 'expanded', dark: true, longPrompts: true },
    { name: 'long-prompts-results', width: 390, height: 1200, mode: 'results', longPrompts: true },
    { name: 'phone-360', width: 360, height: 800, mode: 'single', dark: true },
    { name: 'desktop', width: 1440, height: 1000, mode: 'single', dark: true },
    { name: 'recent-overflow', width: 360, height: 800, mode: 'recent', dark: true },
    { name: 'mobile-remove-confirmation', width: 390, height: 844, mode: 'remove' },
    { name: 'menu-wide-dark', width: 1440, height: 1000, mode: 'menu', dark: true },
    { name: 'menu-mobile-dark', width: 390, height: 844, mode: 'menu', dark: true },
    { name: 'mobile-project-action', width: 390, height: 1000, mode: 'other', dark: true },
    { name: 'default-wide', width: 1440, height: 1000, mode: 'single' },
    { name: 'default-mobile', width: 390, height: 844, mode: 'single' },
    { name: 'group-mobile', width: 390, height: 1000, mode: 'single-group' },
    { name: 'group-draft-mobile', width: 390, height: 1000, mode: 'single-group-draft' },
    { name: 'wide-own-project', width: 1440, height: 1100, mode: 'own' },
    { name: 'return-mobile', width: 390, height: 844, mode: 'return' },
    { name: 'wide', width: 1440, height: 1200, mode: 'overview', dark: true },
    { name: 'mobile-settings', width: 390, height: 1000, mode: 'settings' },
    { name: 'mobile', width: 390, height: 844, mode: 'overview' },
    { name: 'mobile-own-project', width: 390, height: 1000, mode: 'own', dark: true },
    { name: 'wide-results', width: 1440, height: 1100, mode: 'results' },
    { name: 'mobile-results', width: 390, height: 1200, mode: 'results' },
]
for (const shot of captures.filter(shot => !process.argv[2] || shot.name === process.argv[2])) {
    const commonPrompt = shot.longPrompts ? `${commonTask}\n\nСохрани текущие настройки и проверь независимый запуск всех агентов.\n`.repeat(35) : commonTask
    const ownPrompt = shot.longPrompts ? `${ownTask}\n\nПроверь известный отказ, потерянный ответ и безопасный повтор. Не создавай повторных чатов.\n`.repeat(25) + 'https://example.test/trace/' + 'unbroken-token-'.repeat(100) : ownTask
    const requests = []
    console.log(JSON.stringify(await captureHapiUi({
        url: `${origin}/sessions/new?directory=${encodeURIComponent('/home/shandori/code/hapi')}`,
        out: `/tmp/hapi-single-prompt-${shot.name}.png`, width: shot.width, height: shot.height,
        expect: shot.mode === 'single-prompt-result' ? 'text=Did not start' : shot.mode === 'expanded' ? 'article:nth-of-type(2) [role="region"]' : shot.mode === 'recent' ? '[role="dialog"][aria-label="More recent paths"]' : shot.mode === 'remove' ? '[role="dialog"]' : shot.mode === 'menu' ? '[role="menu"]' : shot.mode === 'other' ? 'article:nth-of-type(2) button:has-text("Another project")' : ['single', 'single-prompt', 'single-group', 'single-group-draft', 'return'].includes(shot.mode) ? 'button:has-text("Add another chat")' : shot.mode === 'settings' ? 'section[aria-label="Shared settings"] input[maxlength="120"]' : shot.mode === 'own' ? 'article:nth-of-type(2) input[type="text"]'
            : shot.mode === 'results' ? 'text=Launch outcome unknown' : 'button:has-text("Launch 3 chats")',
        prepare: async page => {
            await page.addInitScript(dark => {
                sessionStorage.removeItem('hapi:session-composition:standalone')
                localStorage.setItem('hapi-lang', 'en')
                localStorage.setItem('hapi-appearance', dark ? 'dark' : 'light')
                localStorage.setItem('hapi-color-theme', dark ? 'telegram' : 'default')
            }, Boolean(shot.dark))
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
            await expect(page.getByRole('textbox', { name: 'Group name', exact: true })).toBeVisible()
            await expect(page.getByRole('checkbox', { name: 'Create a group with this chat' })).toHaveCount(0)
            async function verifySpacing(scope, selectors) {
                for (const selector of selectors) {
                    const spacing = await scope.locator(selector).evaluate(element => {
                        const block = getComputedStyle(element)
                        const choices = getComputedStyle(element.lastElementChild)
                        return { padding: [block.paddingTop, block.paddingRight, block.paddingBottom, block.paddingLeft], gap: [choices.rowGap, choices.columnGap] }
                    })
                    expect(spacing.padding).toEqual(Array(4).fill(shot.width >= 640 ? '12px' : '8px'))
                    expect(spacing.gap).toEqual(Array(2).fill(shot.width >= 640 ? '12px' : selector.includes('Model') ? '4px' : '8px'))
                }
            }
            if (['single', 'single-prompt', 'single-prompt-result', 'single-group', 'single-group-draft', 'recent'].includes(shot.mode)) {
                await verifySpacing(page, ['fieldset[aria-label="Agent"]', 'section[aria-label="Model"]', 'section[aria-label="Speed"]'])
                const recent = page.getByRole('group', { name: 'Recent paths:', exact: true })
                if (shot.name === 'phone-360') {
                    await page.setViewportSize({ width: 1100, height: shot.height })
                    await expect.poll(() => recent.locator('button').evaluateAll(buttons => new Set(buttons.map(button => Math.round(button.getBoundingClientRect().top))).size)).toBe(1)
                    await page.setViewportSize({ width: shot.width, height: shot.height })
                    await expect.poll(() => recent.locator('button').evaluateAll(buttons => new Set(buttons.map(button => Math.round(button.getBoundingClientRect().top))).size)).toBeLessThanOrEqual(2)
                }
                const recentRows = await recent.locator('button').evaluateAll(buttons => new Set(buttons.map(button => Math.round(button.getBoundingClientRect().top))).size)
                expect(recentRows).toBeLessThanOrEqual(shot.width >= 640 ? 1 : 2)
                if (shot.width < 640) {
                    const add = await page.getByRole('button', { name: 'Add another chat', exact: true }).boundingBox()
                    const create = await page.getByRole('button', { name: 'Create', exact: true }).boundingBox()
                    expect(Math.abs(add.y - create.y)).toBeLessThanOrEqual(1)
                    const agents = await page.locator('fieldset[aria-label="Agent"] label').evaluateAll(labels => new Set(labels.map(label => Math.round(label.getBoundingClientRect().top))).size)
                    expect(agents).toBeLessThanOrEqual(2)
                    const models = await page.locator('section[aria-label="Model"] button').evaluateAll(buttons => new Set(buttons.map(button => Math.round(button.getBoundingClientRect().top))).size)
                    expect(models).toBe(1)
                } else {
                    const agentLabel = page.locator('fieldset[aria-label="Agent"]').getByText('Agent', { exact: true })
                    const modelLabel = page.locator('section[aria-label="Model"]').getByText('Model', { exact: true })
                    const speedLabel = page.getByRole('group', { name: 'Speed', exact: true }).getByText('Speed', { exact: true })
                    await expect(speedLabel).toBeVisible()
                    await expect(agentLabel).toBeVisible()
                    await expect(modelLabel).toBeVisible()
                    const agent = await agentLabel.boundingBox()
                    const model = await modelLabel.boundingBox()
                    expect(Math.abs(agent.x + agent.width - model.x - model.width)).toBeLessThanOrEqual(1)
                    const speed = await speedLabel.boundingBox()
                    expect(Math.abs(speed.x + speed.width - model.x - model.width)).toBeLessThanOrEqual(1)
                    for (const label of [agentLabel, modelLabel, speedLabel]) {
                        const spacing = await label.evaluate(element => {
                            const caption = element.parentElement
                            const rule = caption.getBoundingClientRect()
                            const text = document.createRange()
                            text.selectNodeContents(element)
                            const firstChoice = caption.nextElementSibling.querySelector('button, label').getBoundingClientRect()
                            return {
                                before: rule.right - parseFloat(getComputedStyle(caption).borderRightWidth) - text.getBoundingClientRect().right,
                                after: firstChoice.left - rule.right,
                            }
                        })
                        expect(spacing.before).toBeCloseTo(12, 1)
                        expect(spacing.after).toBeCloseTo(12, 1)
                    }
                }
                if (shot.mode === 'recent') {
                    await recent.getByRole('button', { name: 'More recent paths' }).click()
                    const popover = page.getByRole('dialog', { name: 'More recent paths' })
                    const path = await popover.getByRole('button').last().getAttribute('title')
                    await popover.getByRole('button').last().click()
                    await expect(page.getByRole('textbox', { name: 'Directory', exact: true })).toHaveValue(path)
                    await expect(popover).toHaveCount(0)
                    await recent.getByRole('button', { name: 'More recent paths' }).click()
                    await page.setViewportSize({ width: 1440, height: shot.height })
                    await expect(popover).toHaveCount(0)
                    await page.setViewportSize({ width: shot.width, height: shot.height })
                    await expect(recent.getByRole('button', { name: 'More recent paths' })).toBeVisible()
                    await expect(popover).toHaveCount(0)
                    await recent.getByRole('button', { name: 'More recent paths' }).click()
                }
                await expect(page.getByRole('article')).toHaveCount(0)
                await expect(page.getByRole('textbox', { name: 'Shared initial prompt (optional)' })).toHaveCount(0)
                if (shot.mode === 'single-group' || shot.mode === 'single-group-draft') {
                    if (shot.mode === 'single-group') await page.getByRole('textbox', { name: 'Group name', exact: true }).fill('Параллельный разбор')
                    else {
                        await expect(page.getByRole('button', { name: 'Create', exact: true })).toBeEnabled()
                        await expect(page.getByRole('button', { name: 'Add another chat', exact: true })).toBeEnabled()
                    }
                }
                if (shot.mode.startsWith('single-prompt')) {
                    const prompt = page.getByRole('textbox', { name: 'Initial prompt (optional)', exact: true })
                    await prompt.fill(commonTask)
                    await page.getByRole('button', { name: 'Browse', exact: true }).click()
                    await expect(page).not.toHaveURL(/sessions\/new/)
                    await page.goto(`${origin}/sessions/new?directory=${encodeURIComponent('/home/shandori/code/hapi')}`)
                    await page.addStyleTag({ content: '.tsqd-open-btn-container { display: none !important; }' })
                    await expect(prompt).toHaveValue(commonTask)
                    await page.getByRole('button', { name: 'Create', exact: true }).scrollIntoViewIfNeeded()
                    if (shot.mode === 'single-prompt-result') {
                        await page.locator('input[type="radio"][value="claude"]').check()
                        await page.getByRole('textbox', { name: 'Group name', exact: true }).fill('Проверка запуска')
                        await page.getByRole('button', { name: 'Create', exact: true }).click()
                        const retry = page.getByRole('button', { name: 'Retry this chat', exact: true })
                        await expect(retry).toBeEnabled()
                        expect(requests).toHaveLength(1)
                        expect(requests[0]).toMatchObject({ initialPrompt: commonTask, groupId: 'preview-comparison', agent: 'claude' })
                        await retry.click()
                        await expect(retry).toBeEnabled()
                        expect(requests).toHaveLength(2)
                        expect(requests[1]).toMatchObject({ ...requests[0], requestId: expect.any(String) })
                        expect(requests[1].requestId).not.toBe(requests[0].requestId)
                    }
                }
                return
            }
            const originalDirectory = await page.getByRole('textbox', { name: 'Directory', exact: true }).boundingBox()
            await expect(page.getByRole('button', { name: 'Add another chat', exact: true })).toBeEnabled()
            await page.getByRole('button', { name: 'Fast', exact: true }).click()
            await page.getByRole('button', { name: 'Add another chat', exact: true }).click()
            const sharedDirectory = await page.getByRole('textbox', { name: 'Directory', exact: true }).boundingBox()
            expect(Math.abs(sharedDirectory.x - originalDirectory.x)).toBeLessThanOrEqual(1)
            expect(Math.abs(sharedDirectory.width - originalDirectory.width)).toBeLessThanOrEqual(1)
            await expect(page.getByRole('button', { name: /^Place chats/ })).toContainText('No group')
            await expect(page.getByRole('textbox', { name: 'Group name', exact: true })).toHaveValue('')
            await expect(page.getByRole('article').first().getByText(/^GPT-6\.1 Sol Fast(?: \(.+\))?$/)).toBeVisible()
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
            await page.getByRole('dialog').getByRole('button', { name: 'Remove chat', exact: true }).click()
            await expect(page.getByRole('dialog')).toHaveCount(0)
            await page.getByRole('textbox', { name: 'Shared initial prompt (optional)' }).fill(commonPrompt)
            await page.getByRole('textbox', { name: 'Group name', exact: true }).fill('Параллельный разбор')
            await expect(page.getByRole('button', { name: /^Place chats/ })).toContainText('Create a new group')
            await expect(page.getByRole('button', { name: 'Launch chat', exact: true })).toBeEnabled()
            await page.getByRole('button', { name: 'Duplicate 1', exact: true }).click()
            const second = page.getByRole('article').nth(1)
            await second.locator('input[type="radio"][value="claude"]').check()
            await expect(second.getByRole('checkbox', { name: 'Use own prompt' })).toHaveCount(0)
            await second.getByRole('textbox', { name: 'Prompt for this chat (optional)', exact: true }).fill(ownPrompt)
            await second.locator('button[aria-controls^="editor-"]').click()
            await second.getByRole('button', { name: 'Another project', exact: true }).click()
            await expect(second.locator('button[aria-controls^="editor-"]')).toHaveAttribute('aria-expanded', 'true')
            await second.locator('input[type="text"]').fill('/home/shandori/code/desk')
            await second.locator('input[type="text"]').blur()
            await second.getByRole('button', { name: 'Use shared project', exact: true }).click()
            await expect(second.getByRole('textbox', { name: 'Another project', exact: true })).toHaveCount(0)
            await expect(second.getByText('/home/shandori/code/hapi', { exact: true })).toBeVisible()
            await second.getByRole('button', { name: 'Another project', exact: true }).click()
            await second.locator('input[type="text"]').fill('/home/shandori/code/desk')
            await second.locator('input[type="text"]').blur()
            await page.getByRole('button', { name: 'Add chat', exact: true }).click()
            const third = page.getByRole('article').nth(2)
            await third.locator('input[type="radio"][value="agy"]').check()
            await expect(page.getByRole('button', { name: 'Launch 3 chats', exact: true })).toBeEnabled()
            await third.locator('button[aria-controls^="editor-"]').click()
            {
                for (const card of await page.getByRole('article').all()) {
                    const duplicate = card.getByRole('button', { name: /^Duplicate/ })
                    if (shot.width < 640) await expect(duplicate.locator('span')).toBeHidden()
                    const summary = await card.locator('button[aria-controls^="editor-"]').boundingBox()
                    const action = await duplicate.boundingBox()
                    if (shot.width < 640) expect(Math.abs(summary.y - action.y)).toBeLessThanOrEqual(1)
                    else expect(Math.abs(summary.y + summary.height / 2 - action.y - action.height / 2)).toBeLessThanOrEqual(1)
                    expect(action.width).toBeGreaterThanOrEqual(36)
                }
            }
            for (const shared of [page.getByRole('article').first(), third]) {
                const trigger = shared.getByRole('button', { name: 'Shared prompt', exact: true })
                await expect(trigger).toBeVisible()
                await expect(shared.locator('p').filter({ hasText: commonTask })).toHaveCount(0)
                await trigger.click()
                expect(await shared.getByRole('region', { name: 'Shared prompt', exact: true }).textContent()).toBe(commonPrompt)
                await trigger.click()
            }
            const custom = second.getByRole('button', { name: 'Show custom prompt', exact: true })
            await expect(custom).toBeVisible()
            await expect(second.locator('p').filter({ hasText: ownTask })).toHaveCount(0)
            await custom.click()
            const preview = second.getByRole('region', { name: 'Show custom prompt', exact: true })
            expect(await preview.textContent()).toBe(ownPrompt)
            expect((await preview.boundingBox()).height).toBeLessThanOrEqual(192)
            await expect(second.locator('p').filter({ hasText: commonTask })).toHaveCount(0)
            if (shot.mode !== 'expanded') {
                await custom.click()
                await expect(preview).toHaveCount(0)
            }
            if (shot.mode === 'remove') {
                await second.getByRole('button', { name: 'Remove chat 2', exact: true }).click()
                await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click()
                await expect(page.getByRole('article')).toHaveCount(3)
                await expect(second.getByRole('button', { name: 'Show custom prompt', exact: true })).toBeVisible()
                await second.getByRole('button', { name: 'Remove chat 2', exact: true }).click()
                return
            }
            // Pointer, arrow-key and Escape navigation use the actual styled menu.
            if (shot.mode === 'menu') {
                const trigger = page.getByRole('button', { name: /^Place chats/ })
                await trigger.focus()
                await page.keyboard.press('ArrowDown')
                await expect(page.getByRole('menuitemradio', { name: 'Create a new group…', exact: true })).toBeFocused()
                await page.keyboard.press('Home')
                await page.keyboard.press('Enter')
                await expect(trigger).toContainText('No group')
                await expect(trigger).toBeFocused()
                await page.keyboard.press('ArrowDown')
                await page.keyboard.press('Escape')
                await expect(page.getByRole('menu')).toHaveCount(0)
                await expect(trigger).toBeFocused()
                await trigger.click()
                return
            }
            if (shot.mode === 'settings') {
                await page.getByRole('button', { name: /^Place chats/ }).scrollIntoViewIfNeeded()
            } else if (shot.mode === 'own' || shot.mode === 'other') {
                await second.locator('button[aria-controls^="editor-"]').click()
                if (shot.mode === 'other') {
                    await second.getByRole('button', { name: 'Use shared project', exact: true }).click()
                    await expect(second.getByRole('textbox', { name: 'Another project', exact: true })).toHaveCount(0)
                }
                await verifySpacing(second, ['fieldset[aria-label="Agent"]', 'section[aria-label="Model"]'])
                for (const label of ['Agent', 'Model']) {
                    if (shot.width >= 640) await expect(second.getByText(label, { exact: true })).toBeVisible()
                    else await expect(second.getByText(label, { exact: true })).toBeHidden()
                }
                await second.getByRole('textbox', { name: 'Prompt for this chat (optional)' }).evaluate(element => element.scrollIntoView({ block: 'center' }))
            } else if (shot.mode === 'expanded') {
                await preview.evaluate(element => element.scrollIntoView({ block: 'center' }))
            } else if (shot.mode === 'overview') {
                await expect(page.getByText('Exact initial prompt', { exact: true })).toHaveCount(0)
                await expect(second.getByRole('button', { name: 'Show custom prompt', exact: true })).toBeVisible()
                await page.getByRole('button', { name: 'Launch 3 chats', exact: true }).evaluate(element => {
                    for (let container = element.parentElement; container; container = container.parentElement) {
                        if (container.scrollHeight > container.clientHeight && /auto|scroll/.test(getComputedStyle(container).overflowY)) {
                            container.scrollTop = container.scrollHeight
                            break
                        }
                    }
                })
                await expect(third.getByRole('button', { name: 'Shared prompt', exact: true })).toBeInViewport({ ratio: 1 })
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
            if (['own', 'overview'].includes(shot.mode)) {
                const single = await page.getByRole('button', { name: 'Single chat', exact: true }).boundingBox()
                const cancel = await page.getByRole('button', { name: 'Cancel', exact: true }).boundingBox()
                const launch = await page.getByRole('button', { name: 'Launch 3 chats', exact: true }).boundingBox()
                expect(Math.abs(single.y - cancel.y)).toBeLessThanOrEqual(1)
                expect(Math.abs(cancel.y - launch.y)).toBeLessThanOrEqual(1)
                expect(single.x).toBeLessThan(cancel.x)
            }
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
        },
    })))
}
