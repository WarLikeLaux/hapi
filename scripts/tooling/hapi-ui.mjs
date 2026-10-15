import { mkdir } from 'node:fs/promises'
import { dirname, isAbsolute } from 'node:path'
import { chromium } from 'playwright'
import { expect as assert } from '@playwright/test'
import { installHapiAuth, readCliAccessToken } from '../../web/e2e/helpers/hapi-live.ts'

// Shared by the CLI and captures needing custom Playwright interactions or API fixtures.
export async function captureHapiUi({
    url, out, expect, absent, width = 390, height = 844,
    steps = [], prepare, interact,
}) {
    const pageUrl = new URL(url)
    if (!['http:', 'https:'].includes(pageUrl.protocol)
        || !['127.0.0.1', 'localhost', '[::1]'].includes(pageUrl.hostname)
        || pageUrl.username || pageUrl.password) {
        throw new Error('Preview URL must use HTTP(S) on a loopback host so the local access token stays on this machine')
    }
    if (!out || !isAbsolute(out) || !out.endsWith('.png') || !expect) {
        throw new Error('--out must be an absolute PNG path and --expect must identify the changed UI')
    }
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 200 || height < 200) {
        throw new Error('Viewport width and height must be integers of at least 200')
    }

    const accessToken = readCliAccessToken()
    const browser = await chromium.launch({ headless: true })
    try {
        const page = await browser.newPage({ viewport: { width, height } })
        page.setDefaultTimeout(15_000)
        // Authenticate through Vite's /api proxy, preserving its origin.
        await page.addInitScript(() => localStorage.removeItem('hapi_hub_url'))
        await installHapiAuth(page, pageUrl.origin, accessToken)
        if (prepare) await prepare(page)
        const response = await page.goto(pageUrl.href, { waitUntil: 'domcontentloaded', timeout: 30_000 })
        if (!response?.ok()) throw new Error(`Preview page returned HTTP ${response?.status() ?? 'unknown'}`)
        if (new URL(page.url()).origin !== pageUrl.origin) {
            throw new Error('Preview redirected away from its origin')
        }
        for (const { action, selector, value } of steps) {
            const target = page.locator(selector).first()
            switch (action) {
                case 'click': await target.click(); break
                case 'fill': await target.fill(value); break
                case 'press': await target.press(value); break
                case 'hover': await target.hover(); break
                case 'scroll': await target.scrollIntoViewIfNeeded(); break
                case 'wait': await target.waitFor({ state: 'visible' }); break
                case 'dismiss':
                    try {
                        await target.waitFor({ state: 'visible', timeout: 2_000 })
                    } catch (error) {
                        if (error.name !== 'TimeoutError') throw error
                        break // Optional overlay is not present.
                    }
                    await target.click()
                    break
                default: throw new Error(`Unknown capture action: ${action}`)
            }
        }
        if (interact) await interact(page)
        await page.evaluate(() => document.fonts.ready)
        if (absent) await page.locator(absent).first().waitFor({ state: 'hidden' })
        const target = page.locator(expect).first()
        await target.waitFor({ state: 'visible' })
        await target.scrollIntoViewIfNeeded()
        // A DOM-visible element can still be clipped by a nested scroll container.
        await assert(target, 'Expected UI must fit in the screenshot. Choose a smaller --expect target or a larger viewport.').toBeInViewport({ ratio: 1 })
        await mkdir(dirname(out), { recursive: true })
        const png = await page.screenshot({ path: out, animations: 'disabled' })
        return { url: page.url(), image: out, width, height, bytes: png.length }
    } finally {
        await browser.close()
    }
}
