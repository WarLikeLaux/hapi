#!/usr/bin/env bun
// Custom capture for the quota panel with a mocked stale mcode snapshot.
// The new collector code (cli/src/quota/sources/minimax.ts) never returns
// auth_expired once it has cached anything, so the page should keep showing
// last-known usage with a "stale · Xm ago" indicator after 15 minutes instead
// of the red "Authentication expired" banner.

import { chromium } from 'playwright'
import { installHapiAuth, readCliAccessToken } from '../../web/e2e/helpers/hapi-live.ts'

const PREVIEW_ORIGIN = 'http://127.0.0.1:5174'
const OUTPUT_PATH = '/tmp/limits-stale.png'

const nowSec = Math.floor(Date.now() / 1000)
// 22 minutes old — well past STALE_AFTER_MS (15 min) so the "stale" badge shows.
const measuredAt = nowSec - 22 * 60
const resetsAt5h = measuredAt + 5 * 3_600
const resetsAtWeekly = measuredAt + 7 * 24 * 3_600

const mockBody = JSON.stringify({
    quotas: [
        {
            machineId: 'mock-minimax-host',
            displayName: 'mock-minimax-host',
            online: true,
            receivedAt: Date.now() - 22 * 60_000,
            quotas: [
                {
                    source: 'minimax:5h',
                    usedPercent: 12.4,
                    resetsAt: resetsAt5h,
                    measuredAt
                },
                {
                    source: 'minimax:weekly',
                    usedPercent: 41.7,
                    resetsAt: resetsAtWeekly,
                    measuredAt
                },
                {
                    source: 'codex:week',
                    usedPercent: 7,
                    resetsAt: nowSec + 5 * 24 * 3_600,
                    measuredAt: nowSec - 30
                },
                {
                    source: 'zai:5h',
                    usedPercent: 16,
                    resetsAt: nowSec + 3 * 3_600 + 33 * 60,
                    measuredAt: nowSec - 45
                },
                {
                    source: 'agy:5h',
                    usedPercent: 0.5,
                    resetsAt: nowSec + 3 * 3_600 + 30 * 60,
                    measuredAt: nowSec - 60
                },
                {
                    source: 'agy:week',
                    usedPercent: 30.1,
                    resetsAt: nowSec + 2 * 24 * 3_600 + 21 * 3_600,
                    measuredAt: nowSec - 60
                },
                {
                    source: 'cursor:month',
                    usedPercent: 0.8,
                    resetsAt: nowSec + 22 * 24 * 3_600,
                    measuredAt: nowSec - 30
                }
            ],
            unavailable: []
        }
    ]
})

const browser = await chromium.launch({ headless: true })
try {
    const page = await browser.newPage({ viewport: { width: 420, height: 720 } })
    await page.addInitScript(() => localStorage.removeItem('hapi_hub_url'))
    await installHapiAuth(page, PREVIEW_ORIGIN, readCliAccessToken())

    await page.route('**/api/quotas', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: mockBody
        })
    })

    const response = await page.goto(`${PREVIEW_ORIGIN}/settings/limits`, {
        waitUntil: 'domcontentloaded',
        timeout: 30_000
    })
    if (!response?.ok()) throw new Error(`Preview page returned HTTP ${response?.status() ?? 'unknown'}`)
    // Wait for the cached mcode snapshot to render. The collector's replay
    // path leaves measuredAt in the past, which means the row carries a
    // "stale · 22m ago" suffix once STALE_AFTER_MS (15 min) passes.
    await page.waitForSelector('text=MiniMax Code', { timeout: 15_000 })
    try {
        await page.waitForFunction(
            () => document.body.innerText.includes('measured'),
            { timeout: 8_000 }
        )
    } catch {
        const text = await page.evaluate(() => document.body.innerText.slice(0, 600))
        console.error('DEBUG body text:\n' + text)
        throw new Error('stale indicator did not appear within 8s')
    }
    // Let the layout settle (bar widths, lazy text rendering).
    await page.waitForTimeout(500)

    await page.screenshot({ path: OUTPUT_PATH, fullPage: false })
    const stat = await Bun.file(OUTPUT_PATH).stat()
    console.log(JSON.stringify({ url: page.url(), image: OUTPUT_PATH, bytes: stat.size }))
} finally {
    await browser.close()
}