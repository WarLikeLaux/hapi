#!/usr/bin/env bun
// Capture the running HAPI web app through its local Vite proxy.
// Example:
// bun scripts/tooling/capture-hapi-ui.mjs --url http://127.0.0.1:5174/sessions/<id> --out /tmp/menu.png --click 'button[title="More actions"]' --expect '[role="menuitem"]:has-text("Delete")'

import { isAbsolute } from 'node:path'
import { chromium } from 'playwright'
import { installHapiAuth, readCliAccessToken } from '../../web/e2e/helpers/hapi-live.ts'

const args = process.argv.slice(2)
const values = new Map()
for (let i = 0; i < args.length; i += 2) {
    const key = args[i]
    const value = args[i + 1]
    if (!key?.startsWith('--') || !value || value.startsWith('--') || values.has(key)) {
        throw new Error('Expected unique --url, --out, --expect and optional --click, --dismiss, --absent, --width, --height arguments')
    }
    values.set(key, value)
}

const pageUrl = new URL(values.get('--url'))
const outputPath = values.get('--out')
const expectedSelector = values.get('--expect')
if (!['127.0.0.1', 'localhost', '[::1]'].includes(pageUrl.hostname)) {
    throw new Error('Preview URL must use a loopback host so the local access token stays on this machine')
}
if (!outputPath || !isAbsolute(outputPath) || !outputPath.endsWith('.png') || !expectedSelector) {
    throw new Error('--out must be an absolute PNG path and --expect must identify the changed UI')
}
for (const key of values.keys()) {
    if (!['--url', '--out', '--expect', '--click', '--dismiss', '--absent', '--width', '--height'].includes(key)) {
        throw new Error(`Unknown argument: ${key}`)
    }
}
const width = Number(values.get('--width') ?? 390)
const height = Number(values.get('--height') ?? 844)
if (!Number.isInteger(width) || !Number.isInteger(height) || width < 200 || height < 200) {
    throw new Error('Viewport width and height must be integers of at least 200')
}

const browser = await chromium.launch({ headless: true })
try {
    const page = await browser.newPage({ viewport: { width, height } })
    // An explicit hub URL bypasses Vite's /api proxy and causes CORS failures.
    await page.addInitScript(() => localStorage.removeItem('hapi_hub_url'))
    await installHapiAuth(page, pageUrl.origin, readCliAccessToken())
    const response = await page.goto(pageUrl.href, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    if (!response?.ok()) throw new Error(`Preview page returned HTTP ${response?.status() ?? 'unknown'}`)
    const dismissSelector = values.get('--dismiss')
    if (dismissSelector) {
        const dismissButton = page.locator(dismissSelector).first()
        try {
            await dismissButton.waitFor({ state: 'visible', timeout: 2_000 })
            await dismissButton.click()
        } catch {
            // The optional overlay may already have been dismissed.
        }
    }
    const clickSelector = values.get('--click')
    if (clickSelector) await page.locator(clickSelector).first().click({ timeout: 15_000 })
    await page.locator(expectedSelector).first().waitFor({ state: 'visible', timeout: 15_000 })
    const absentSelector = values.get('--absent')
    if (absentSelector && await page.locator(absentSelector).count() > 0) {
        throw new Error(`Unexpected UI is still present: ${absentSelector}`)
    }
    const png = await page.screenshot({ path: outputPath })
    console.log(JSON.stringify({ url: pageUrl.href, image: outputPath, width, height, bytes: png.length }))
} finally {
    await browser.close()
}
