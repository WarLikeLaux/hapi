import { expect, test } from '@playwright/test'

const BASE = 'http://127.0.0.1:5174'

test.use({
    launchOptions: {
        executablePath: process.env.PLAYWRIGHT_CHROME_PATH ?? '/home/shandori/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    },
})

test('share-turn image preview survives sourceSnapshots reference change', async ({ page }) => {
    const logs: string[] = []
    page.on('console', (msg) => logs.push(`[${msg.type()}] ${msg.text()}`))
    page.on('pageerror', (err) => logs.push(`[pageerror] ${err.message}`))

    await page.goto(`${BASE}/e2e-fixtures/share-turn-lightbox-fixture.html`)
    await page.waitForSelector('button:has-text("Open Share Turn Dialog")')

    await page.locator('button:has-text("Open Share Turn Dialog")').click()
    await page.waitForSelector('button[data-image-preview-trigger]', { timeout: 5_000 })

    // Open lightbox
    await page.locator('button[data-image-preview-trigger]').click()
    await page.waitForFunction(() => {
        return document.querySelectorAll('[role="dialog"]').length >= 2
    }, { timeout: 5_000 })

    const initialDialogs = await page.locator('[role="dialog"]').count()
    expect(initialDialogs, 'both dialogs open after click').toBeGreaterThanOrEqual(2)

    // Simulate parent re-render with a fresh sourceSnapshots array reference
    await page.evaluate(() => {
        document.getElementById('bump-snapshots')?.click()
    })
    await page.waitForTimeout(400)
    const dialogsAfterBump = await page.locator('[role="dialog"]').count()
    expect(
        dialogsAfterBump,
        'inner lightbox must remain open after sourceSnapshots reference change',
    ).toBeGreaterThanOrEqual(2)

    // Multiple bumps must keep the lightbox open
    for (let i = 0; i < 3; i++) {
        await page.evaluate(() => {
            document.getElementById('bump-snapshots')?.click()
        })
        await page.waitForTimeout(150)
    }
    await page.waitForTimeout(500)
    const dialogsAfterMultipleBumps = await page.locator('[role="dialog"]').count()
    expect(
        dialogsAfterMultipleBumps,
        'inner lightbox must remain open after multiple sourceSnapshots bumps',
    ).toBeGreaterThanOrEqual(2)

    console.log('logs:')
    for (const l of logs) console.log(' ', l)
})

test('share-turn: closing and reopening clears the previous preview', async ({ page }) => {
    await page.goto(`${BASE}/e2e-fixtures/share-turn-lightbox-fixture.html`)
    await page.waitForSelector('button:has-text("Open Share Turn Dialog")')

    // First session
    await page.locator('button:has-text("Open Share Turn Dialog")').click()
    await page.waitForSelector('button[data-image-preview-trigger]', { timeout: 5_000 })
    await page.locator('button[data-image-preview-trigger]').click()
    await page.waitForFunction(() => document.querySelectorAll('[role="dialog"]').length >= 2, { timeout: 5_000 })

    // Close the inner lightbox via Escape (we don't have a stable close
    // button selector); then close the outer dialog via onClose path
    // (clicking outside overlay triggers Radix Dialog close).
    await page.keyboard.press('Escape')
    await page.waitForTimeout(200)

    // Close outer dialog by clicking the overlay area
    await page.keyboard.press('Escape')
    await page.waitForTimeout(200)
    const closedDialogs = await page.locator('[role="dialog"]').count()
    expect(closedDialogs, 'no dialogs after close').toBe(0)

    // Reopen
    await page.locator('button:has-text("Open Share Turn Dialog")').click()
    await page.waitForSelector('button[data-image-preview-trigger]', { timeout: 5_000 })
    const dialogsAfterReopen = await page.locator('[role="dialog"]').count()
    expect(dialogsAfterReopen, 'reopen must not carry over inner lightbox').toBe(1)
})