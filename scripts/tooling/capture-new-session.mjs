#!/usr/bin/env bun
// Capture the Create Session page on the slot dev server. Mirrors capture-hapi-ui.mjs
// but lands directly on /sessions/new (full-page route, not a modal).
// Usage:
// bun scripts/tooling/capture-new-session.mjs --out /tmp/hapi-new-session.png

import { isAbsolute } from 'node:path'
import { chromium } from 'playwright'
import { installHapiAuth, readCliAccessToken } from '../../web/e2e/helpers/hapi-live.ts'

const args = process.argv.slice(2)
const values = new Map()
for (let i = 0; i < args.length; i += 2) {
    const key = args[i]
    const value = args[i + 1]
    if (!key?.startsWith('--') || !value || value.startsWith('--') || values.has(key)) {
        throw new Error('Expected unique --url, --out and optional --width, --height arguments')
    }
    values.set(key, value)
}

const outputPath = values.get('--out')
const baseUrl = values.get('--url') ?? 'http://127.0.0.1:5174'
const pageUrl = new URL('/sessions/new', baseUrl)
const width = Number(values.get('--width') ?? 1280)
const height = Number(values.get('--height') ?? 720)
if (!outputPath || !isAbsolute(outputPath) || !outputPath.endsWith('.png')) {
    throw new Error('--out must be an absolute PNG path')
}
if (!['127.0.0.1', 'localhost', '[::1]'].includes(pageUrl.hostname)) {
    throw new Error('Preview URL must use a loopback host so the local access token stays on this machine')
}
if (!Number.isInteger(width) || !Number.isInteger(height) || width < 200 || height < 200) {
    throw new Error('Viewport width and height must be integers of at least 200')
}

const browser = await chromium.launch({ headless: true })
try {
    const page = await browser.newPage({ viewport: { width, height } })
    await page.addInitScript(() => localStorage.removeItem('hapi_hub_url'))
    await installHapiAuth(page, pageUrl.origin, readCliAccessToken())
    const response = await page.goto(pageUrl.href, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    if (!response?.ok()) throw new Error(`Preview page returned HTTP ${response?.status() ?? 'unknown'}`)
    // Wait for the Directory section + chips to appear so session data has rendered.
    await page.locator('text=Directory').first().waitFor({ state: 'visible', timeout: 30_000 })
    // Allow the chip rows to settle (recent activity ordering, work split).
    await page.waitForTimeout(500)
    const png = await page.screenshot({ path: outputPath, fullPage: false })
    console.log(JSON.stringify({ url: pageUrl.href, image: outputPath, width, height, bytes: png.length }))
} finally {
    await browser.close()
}