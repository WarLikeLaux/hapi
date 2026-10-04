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

test.describe('mobile response reading', () => {
    test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

    test('cold backfill keeps the reader inside a long response while its earlier records load', async ({ page }) => {
        await page.goto('/e2e-fixtures/history-load-fixture.html?conversation=1&denseResponse=1&coldInitial=1&holdBefore=1')
        const viewport = page.locator('.chat-scroll-y')
        const response = page.getByText('Fixture response 1200', { exact: true })
        await expect(response).toHaveCount(1)
        await expect.poll(() => viewport.evaluate(element => (
            element.scrollHeight - element.clientHeight - element.scrollTop
        ))).toBeLessThan(2)

        const box = await viewport.boundingBox()
        if (!box) throw new Error('Missing chat viewport')
        const touch = await page.context().newCDPSession(page)
        const points = (offset: number) => [{
            x: box.x + box.width / 2,
            y: box.y + 100 + offset
        }]
        await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points(0) })
        for (let offset = 30; offset <= 300; offset += 30) {
            await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points(offset) })
            await page.waitForTimeout(30)
        }
        // Pause before release so momentum cannot move the saved reading position.
        await page.waitForTimeout(100)
        await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
        await expect.poll(() => viewport.evaluate(element => (
            element.scrollHeight - element.clientHeight - element.scrollTop
        ))).toBeGreaterThan(200)
        const readingOffset = await response.evaluate(element => (
            element.getBoundingClientRect().top
            - element.closest('.chat-scroll-y')!.getBoundingClientRect().top
        ))

        await page.evaluate(() => window.__probe.releaseBefore())
        await expect(page.getByText('Fixture message 401', { exact: true })).toHaveCount(1)
        await expect.poll(() => response.evaluate((element, savedOffset) => Math.abs(
            element.getBoundingClientRect().top
            - element.closest('.chat-scroll-y')!.getBoundingClientRect().top
            - savedOffset
        ), readingOffset)).toBeLessThan(2)
    })
})
