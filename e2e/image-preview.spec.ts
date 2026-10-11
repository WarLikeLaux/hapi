import { expect, test } from '@playwright/test'

test('image gestures keep the viewer open without scrolling or loading chat history', async ({ page }) => {
    await page.goto('/e2e-fixtures/history-load-fixture.html?conversation=1&screenshot=1')
    const trigger = page.locator('[data-image-preview-trigger]')
    await expect(trigger).toBeVisible()
    await page.waitForTimeout(2000)
    await trigger.click()
    const dialog = page.getByRole('dialog', { name: 'screenshot.svg' })
    await expect(dialog).toBeVisible()
    const viewport = page.locator('.chat-scroll-y')
    const before = await viewport.evaluate(element => element.scrollTop)
    const beforeLoads = await page.evaluate(() => window.__probe.requests.filter(request => request.direction === 'before').length)
    const originalSource = await trigger.locator('img').getAttribute('src')
    const image = dialog.getByRole('img', { name: 'screenshot.svg' })

    await image.hover()
    await page.mouse.wheel(0, -300)
    await expect(dialog.getByTitle('Reset zoom')).toHaveText('125%')
    await page.waitForTimeout(500)
    expect(await viewport.evaluate(element => element.scrollTop)).toBe(before)
    expect(await page.evaluate(() => window.__probe.requests.filter(request => request.direction === 'before').length)).toBe(beforeLoads)

    // A pan that comes back to its origin must not turn into a backdrop click.
    const surface = dialog.locator('.cursor-grab')
    const bounds = await surface.boundingBox()
    if (!bounds) throw new Error('Image surface missing')
    await page.mouse.move(bounds.x + 2, bounds.y + 4)
    await page.mouse.down()
    await page.mouse.move(bounds.x + 100, bounds.y + 80, { steps: 4 })
    await page.mouse.move(bounds.x + 2, bounds.y + 4, { steps: 4 })
    await page.mouse.up()
    await expect(dialog).toBeVisible()

    const touch = await page.context().newCDPSession(page)
    await touch.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 })
    // Touch emulation flips hover/pointer media features, so hover-only
    // message action rows return to the flow and the chat re-flows. The
    // pinch assertion guards against gesture scroll, not that reflow.
    await page.waitForTimeout(200)
    const pinchBaseline = await viewport.evaluate(element => element.scrollTop)
    const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
    const points = (distance: number) => [
        { x: center.x - distance / 2, y: center.y, id: 1 },
        { x: center.x + distance / 2, y: center.y, id: 2 }
    ]
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points(120) })
    await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points(240) })
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByTitle('Reset zoom')).toHaveText('250%')
    expect(await viewport.evaluate(element => element.scrollTop)).toBe(pinchBaseline)
    expect(await page.evaluate(() => window.__probe.requests.filter(request => request.direction === 'before').length)).toBe(beforeLoads)

    // The viewer owns the blob even after the attachment releases its source.
    await expect.poll(() => image.getAttribute('src')).not.toBe(originalSource)
    const viewerSource = await image.getAttribute('src')
    await page.evaluate(source => { if (source) URL.revokeObjectURL(source) }, originalSource)
    expect(await page.evaluate(async source => source ? (await fetch(source)).ok : false, viewerSource)).toBe(true)
    await dialog.getByTitle('Close', { exact: true }).click()
    await expect(dialog).toHaveCount(0)
    expect(await page.evaluate(async source => source ? fetch(source).then(response => response.ok).catch(() => false) : false, viewerSource)).toBe(false)
})
