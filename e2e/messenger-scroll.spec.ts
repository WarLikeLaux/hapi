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
        element.querySelector<HTMLElement>('[data-provider-message-id]')!.style.paddingBottom = '500px'
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
