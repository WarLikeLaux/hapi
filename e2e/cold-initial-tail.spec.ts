import { expect, test } from '@playwright/test'

test('cold sessions request a full latest page, auto-extend coverage, and keep older loads at 200', async ({ page }) => {
    await page.goto('/e2e-fixtures/history-load-fixture.html?coldInitial=1')
    const viewport = page.locator('.app-scroll-y')
    await expect(viewport).toBeVisible()

    await expect.poll(async () => await page.evaluate(() => window.__probe.requests.length)).toBeGreaterThan(0)
    await expect.poll(async () => await page.evaluate(() => ({
        direction: window.__probe.requests[0]?.direction ?? null,
        limit: window.__probe.requests[0]?.limit ?? null,
        childCount: document.querySelector('.happy-thread-messages')?.childElementCount ?? 0
    }))).toEqual({
        direction: 'latest',
        limit: 200,
        childCount: expect.any(Number)
    })

    // The cold tail sync automatically extends coverage backward (the only
    // automatic older-page loading), so before-pages fire without any user
    // scroll; a prepend that would evict the newest rows is followed by a
    // fresh latest fetch, so the tail content stays present either way.
    await expect.poll(async () => await page.evaluate(
        () => window.__probe.requests.some((request) => request.direction === 'before')
    )).toBe(true)
    await expect(page.getByText('Fixture message 1200', { exact: true })).toBeVisible()

    // Call the same loadMore callback that the top sentinel invokes. The
    // dedicated history-load suite covers pointer/scroll gesture detection;
    // this regression should isolate the page-size contract without relying
    // on IntersectionObserver timing.
    await page.evaluate(() => window.__probe.loadMore())

    await expect.poll(async () => await page.evaluate(() => {
        const older = window.__probe.requests.filter((request) => request.direction === 'before')
        return older[0]?.limit ?? null
    })).toBe(200)
})
