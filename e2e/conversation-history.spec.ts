import { expect, test } from '@playwright/test'

test('history loads and late content sizing preserve the current reading position after manual scrolling', async ({ page }) => {
    await page.goto('/e2e-fixtures/history-load-fixture.html?conversation=1')
    const viewport = page.locator('.chat-scroll-y')
    await expect(viewport).toBeVisible()
    await expect(page.getByText('Fixture message 801', { exact: true })).toHaveCount(1)
    await expect(page.getByText('Fixture response 1200', { exact: false })).toBeVisible()
    await page.waitForTimeout(2000)

    for (const olderPrompt of [601, 401]) {
        await page.evaluate(() => window.__probe.holdBefore())
        await viewport.dispatchEvent('pointerdown', { button: 0, pointerType: 'mouse' })
        await viewport.evaluate(element => {
            element.scrollTop = 0
            element.dispatchEvent(new Event('scroll'))
        })
        await viewport.dispatchEvent('pointerup', { button: 0, pointerType: 'mouse' })
        await expect.poll(() => page.evaluate(() => window.__probe.windowState().isLoadingMore)).toBe(true)
        const anchor = await viewport.evaluate(element => {
            const top = element.getBoundingClientRect().top
            const message = [...element.querySelectorAll<HTMLElement>('.happy-thread-messages > [id]')]
                .find(row => row.getBoundingClientRect().bottom > top)
            if (!message) throw new Error('No visible conversation anchor')
            return { id: message.id, offset: message.getBoundingClientRect().top - top }
        })

        await page.evaluate(() => window.__probe.releaseBefore())
        await expect(page.getByText(`Fixture message ${olderPrompt}`, { exact: true })).toHaveCount(1)
        await expect.poll(() => viewport.evaluate((element, saved) => {
            const message = document.getElementById(saved.id)
            return message ? Math.abs(message.getBoundingClientRect().top - element.getBoundingClientRect().top - saved.offset) : Infinity
        }, anchor)).toBeLessThan(2)

        // An attachment or markdown block above the reader can finish sizing after the page is applied.
        await page.evaluate(saved => {
            const preceding = document.getElementById(saved.id)?.previousElementSibling
            if (!(preceding instanceof HTMLElement)) throw new Error('No preceding message to resize')
            preceding.style.paddingBottom = '180px'
        }, anchor)
        await expect.poll(() => viewport.evaluate((element, saved) => {
            const message = document.getElementById(saved.id)
            return message ? Math.abs(message.getBoundingClientRect().top - element.getBoundingClientRect().top - saved.offset) : Infinity
        }, anchor)).toBeLessThan(2)

        const movedAnchor = await viewport.evaluate(element => {
            element.scrollTop += 150
            element.dispatchEvent(new Event('scroll'))
            const top = element.getBoundingClientRect().top
            const message = [...element.querySelectorAll<HTMLElement>('.happy-thread-messages > [id]')]
                .find(row => row.getBoundingClientRect().bottom > top)
            if (!message) throw new Error('No visible conversation anchor after scrolling')
            return { id: message.id, offset: message.getBoundingClientRect().top - top }
        })
        await page.evaluate(saved => {
            const preceding = document.getElementById(saved.id)?.previousElementSibling
            if (!(preceding instanceof HTMLElement)) throw new Error('No preceding message to resize')
            preceding.style.paddingBottom = '360px'
        }, anchor)
        await expect.poll(() => viewport.evaluate((element, saved) => {
            const message = document.getElementById(saved.id)
            return message ? Math.abs(message.getBoundingClientRect().top - element.getBoundingClientRect().top - saved.offset) : Infinity
        }, movedAnchor)).toBeLessThan(2)
    }

    await page.evaluate(() => window.__probe.refetch())
    await expect(page.getByText('Fixture message 401', { exact: true })).toHaveCount(1)
    await expect(page.getByText('Fixture message 1001', { exact: true })).toHaveCount(1)
})
