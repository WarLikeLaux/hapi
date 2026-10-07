import { expect, test } from '@playwright/test'

test('switching messenger chats stays at the newest message through queued scroll events and late media sizing', async ({ page }) => {
    await page.goto('/e2e-fixtures/messenger-scroll-fixture.html')
    const viewport = page.locator('.overflow-y-auto')
    const gap = () => viewport.evaluate(element => element.scrollHeight - element.clientHeight - element.scrollTop)
    await expect(page.getByText('short message 29', { exact: true })).toBeVisible()
    await expect.poll(gap).toBeLessThan(2)

    for (const id of ['long', 'short', 'long']) {
        await page.getByRole('button', { name: `Open ${id}`, exact: true }).click()
        await expect(page.getByText(`${id} message ${id === 'short' ? 29 : 69}`, { exact: true })).toBeVisible()
        await expect.poll(gap).toBeLessThan(2)
        await expect.poll(() => viewport.locator('[data-image-preview-trigger] img').evaluateAll(images => (
            images.length > 0 && images.every(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalHeight > 0)
        ))).toBe(true)
        await page.waitForTimeout(100)
        await expect.poll(gap).toBeLessThan(2)

        // Native scroll events are delivered in a later rendering step. Media
        // can expand after a bottom scroll was queued, before its event runs.
        await viewport.evaluate(element => {
            element.scrollTop -= 10
            element.scrollTop = element.scrollHeight
            const row = element.querySelector<HTMLElement>('[data-provider-message-id]')!
            row.style.paddingBottom = '300px'
        })
        await page.waitForTimeout(100)
        await expect.poll(gap).toBeLessThan(2)
    }

    // Browsers may adjust a viewport while cached media is replaced. Without
    // reader input, that movement must not turn opening a chat into history mode.
    await viewport.evaluate(element => {
        element.scrollTop -= 300
    })
    await page.waitForTimeout(100)
    await viewport.evaluate(element => {
        element.querySelector<HTMLElement>('[data-provider-message-id]')!.style.paddingBottom = '600px'
    })
    await page.waitForTimeout(100)
    await expect.poll(gap).toBeLessThan(2)

    // Real upward scrolling releases the pin, and loading media above the
    // reader must keep the same message at the same viewport offset.
    await viewport.hover()
    await page.mouse.wheel(0, -450)
    await expect.poll(gap).toBeGreaterThan(200)
    await page.waitForTimeout(100)
    const anchor = await viewport.evaluate(element => {
        const top = element.getBoundingClientRect().top
        const row = [...element.querySelectorAll<HTMLElement>('[data-provider-message-id]')]
            .find(row => row.getBoundingClientRect().bottom > top)!
        return { id: row.dataset.providerMessageId!, offset: row.getBoundingClientRect().top - top }
    })
    await viewport.evaluate(element => {
        element.querySelector<HTMLElement>('[data-provider-message-id]')!.style.paddingBottom = '800px'
    })
    await expect.poll(() => viewport.evaluate((element, saved) => {
        const row = element.querySelector<HTMLElement>(`[data-provider-message-id="${saved.id}"]`)!
        return Math.abs(row.getBoundingClientRect().top - element.getBoundingClientRect().top - saved.offset)
    }, anchor)).toBeLessThan(2)
    await expect.poll(gap).toBeGreaterThan(200)

    await page.getByRole('button', { name: 'Open short', exact: true }).click()
    await expect(page.getByText('short message 29', { exact: true })).toBeVisible()
    await expect.poll(gap).toBeLessThan(2)
})

test('opening another conversation starts with fresh pane state instead of carrying the previous composer', async ({ page }) => {
    await page.goto('/e2e-fixtures/messenger-scroll-fixture.html')
    await expect(page.getByText('short message 29', { exact: true })).toBeVisible()
    await page.getByRole('textbox').fill('Draft from the previous chat')
    await page.getByRole('button', { name: 'Open long', exact: true }).click()
    await expect(page.getByText('long message 69', { exact: true })).toBeVisible()
    await expect(page.getByRole('textbox')).toHaveValue('')
})

test('keyboard navigation can leave the newest message and return to it', async ({ page }) => {
    await page.goto('/e2e-fixtures/messenger-scroll-fixture.html')
    await page.getByRole('button', { name: 'Open long', exact: true }).click()
    const viewport = page.locator('.overflow-y-auto')
    const gap = () => viewport.evaluate(element => element.scrollHeight - element.clientHeight - element.scrollTop)
    await expect(page.getByText('long message 69', { exact: true })).toBeVisible()
    await expect.poll(gap).toBeLessThan(2)
    await viewport.focus()
    await page.keyboard.press('PageUp')
    await expect.poll(gap).toBeGreaterThan(200)
    await page.keyboard.press('End')
    await expect.poll(gap).toBeLessThan(2)
    await page.keyboard.press('Home')
    await expect.poll(() => viewport.evaluate(element => element.scrollTop)).toBeLessThan(2)
})

test.describe('touch scrolling over messenger media', () => {
    test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

    test('a downward finger swipe starting on a photo releases the newest-message pin', async ({ page }) => {
        await page.goto('/e2e-fixtures/messenger-scroll-fixture.html')
        await page.getByRole('button', { name: 'Open long', exact: true }).click()
        const viewport = page.locator('.overflow-y-auto')
        const photo = viewport.locator('[data-provider-message-id="long-69"] [data-image-preview-trigger]')
        await expect(photo).toBeVisible()
        await expect.poll(() => photo.locator('img').evaluate(image => image.complete && image.naturalHeight > 0)).toBe(true)
        const box = await photo.boundingBox()
        if (!box) throw new Error('Photo is not mounted')
        const touch = await page.context().newCDPSession(page)
        const point = (dy: number) => [{ x: box.x + box.width / 2, y: box.y + 30 + dy }]
        await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point(0) })
        for (let dy = 20; dy <= 240; dy += 20) {
            await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: point(dy) })
            await page.waitForTimeout(20)
        }
        await page.waitForTimeout(100)
        await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
        const gap = () => viewport.evaluate(element => element.scrollHeight - element.clientHeight - element.scrollTop)
        await expect.poll(gap).toBeGreaterThan(100)
        await page.waitForTimeout(300)
        await expect.poll(gap).toBeGreaterThan(100)
    })
})
