import { expect, test } from '@playwright/test'

const preview = process.env.HAPI_UI_PREVIEW_URL ?? 'http://127.0.0.1:5174'

for (const provider of ['telegram', 'telemost']) {
    test(`${provider}: text bubbles fit their wrapped lines and expand again after resizing`, async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 })
        await page.goto(`${preview}/e2e-fixtures/messenger-scroll-fixture.html`)
        await page.getByRole('button', { name: `Open bubbles-${provider}`, exact: true }).click()
        const rows = page.locator('[data-provider-message-id]')
        await expect(rows).toHaveCount(10)

        const metrics = () => rows.evaluateAll(elements => elements.map(row => {
            const text = row.querySelector<HTMLElement>('.whitespace-pre-wrap')!
            const bubble = text.closest<HTMLElement>('.happy-chat-text')!
            const time = bubble.querySelector('time')!.getBoundingClientRect()
            const range = document.createRange()
            const fragments: DOMRect[] = []
            const walker = document.createTreeWalker(text, NodeFilter.SHOW_TEXT)
            let node: Node | null
            while ((node = walker.nextNode())) {
                // pre-wrap lets spaces hang past the line box. Measure visible
                // words so intentional line-ending spaces aren't overflow.
                for (const word of node.textContent!.matchAll(/\S+/g)) {
                    range.setStart(node, word.index!)
                    range.setEnd(node, word.index! + word[0].length)
                    fragments.push(...Array.from(range.getClientRects()))
                }
            }
            const textBox = text.getBoundingClientRect()
            const style = getComputedStyle(bubble)
            return {
                id: row.getAttribute('data-provider-message-id'),
                width: bubble.getBoundingClientRect().width,
                spare: textBox.right - Math.max(...fragments.map(rect => rect.right)),
                lines: new Set(fragments.map(rect => Math.round(rect.top))).size,
                contained: fragments.every(rect => rect.left >= textBox.left - 1 && rect.right <= textBox.right + 1)
                    && time.right <= bubble.getBoundingClientRect().right - parseFloat(style.paddingRight) + 1,
            }
        }))

        let mobile: Awaited<ReturnType<typeof metrics>> | undefined
        for (const width of [390, 1280, 320, 390]) {
            await page.setViewportSize({ width, height: 844 })
            await expect.poll(async () => (await metrics()).filter(item => item.spare > 1 || !item.contained), `viewport ${width}`).toEqual([])
            const measured = await metrics()
            for (const direction of ['incoming', 'outgoing']) {
                if (width >= 390) expect(measured.find(item => item.id === `bubble-1-${direction}`)!.lines).toBe(3)
                if (width <= 390) {
                    expect(measured.find(item => item.id === `bubble-2-${direction}`)!.lines).toBeGreaterThan(1)
                }
                if (width === 1280) {
                    const id = `bubble-2-${direction}`
                    await expect.poll(async () => (await metrics()).find(item => item.id === id)!.width)
                        .toBeGreaterThan(mobile!.find(item => item.id === id)!.width)
                    expect((await metrics()).find(item => item.id === id)!.lines)
                        .toBeLessThan(mobile!.find(item => item.id === id)!.lines)
                }
            }
            if (!mobile) mobile = measured
        }
        await expect(page.locator('a[href^="https://example.com/"]')).toHaveCount(2)
    })
}
