import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { defaultComponents, UriConfirmProvider } from '@/components/assistant-ui/markdown-text'
import { I18nProvider } from '@/lib/i18n-context'
import { encodeBase64 } from '@/lib/utils'
import { ApiClient } from '@/api/client'
import { AppContextProvider } from '@/lib/app-context'

vi.mock('@/components/AssistantChat/context', () => ({
    useOptionalHappyChatContext: () => ({ sessionId: 'session-1' }),
}))

const AnchorComponent = (defaultComponents as Record<string, unknown>).a as React.ComponentType<
    React.ComponentPropsWithoutRef<'a'>
>

function renderFileAnchor(filePath: string) {
    return render(
        <I18nProvider>
            <UriConfirmProvider>
                <AnchorComponent href={`hapi-file:${encodeURIComponent(filePath)}`}>
                    {filePath}
                </AnchorComponent>
            </UriConfirmProvider>
        </I18nProvider>
    )
}

describe('chat file anchors', () => {
    it('opens file previews from chat in a new tab', () => {
        const filePath = 'docs/guide.md'
        renderFileAnchor(filePath)
        const link = screen.getByRole('link', { name: filePath })
        const href = new URL(link.getAttribute('href')!, 'https://hapi.example')

        expect(href.pathname).toBe('/sessions/session-1/file')
        expect(href.searchParams.get('path')).toBe(encodeBase64(filePath))
        expect(href.searchParams.get('origin')).toBe('chat')
        expect(link).toHaveAttribute('target', '_blank')
        expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    })

    it('passes a referenced line and column to the file viewer', () => {
        const filePath = 'src/app.ts:42:7'
        renderFileAnchor(filePath)
        const link = screen.getByRole('link', { name: filePath })
        const href = new URL(link.getAttribute('href')!, 'https://hapi.example')

        expect(href.searchParams.get('path')).toBe(encodeBase64('src/app.ts'))
        expect(href.searchParams.get('line')).toBe('42')
        expect(href.searchParams.get('column')).toBe('7')
    })
})

describe('chat file anchors with an external editor', () => {
    const STORAGE_KEY = 'hapi-external-editor-base-url'
    let openSpy: ReturnType<typeof vi.spyOn>
    let originalFetch: typeof globalThis.fetch

    beforeEach(() => {
        window.localStorage.clear()
        originalFetch = globalThis.fetch
        const placeholder = { close: vi.fn(), location: { href: 'about:blank' } }
        openSpy = vi.spyOn(window, 'open').mockReturnValue(placeholder as unknown as Window)
    })

    afterEach(() => {
        openSpy.mockRestore()
        globalThis.fetch = originalFetch
        window.localStorage.clear()
    })

    function renderWithEditor(filePath: string, hubStatus: number, hubBody: unknown) {
        window.localStorage.setItem(STORAGE_KEY, 'https://code.local')
        globalThis.fetch = vi.fn().mockResolvedValue(
            new Response(JSON.stringify(hubBody), { status: hubStatus })
        ) as unknown as typeof globalThis.fetch
        return render(
            <I18nProvider>
                <AppContextProvider value={{ api: new ApiClient('test-token'), token: 'test-token', baseUrl: '' }}>
                    <UriConfirmProvider>
                        <AnchorComponent href={`hapi-file:${encodeURIComponent(filePath)}`}>
                            {filePath}
                        </AnchorComponent>
                    </UriConfirmProvider>
                </AppContextProvider>
            </I18nProvider>
        )
    }

    it('focuses the named editor tab and never closes it when the editor opens the file', async () => {
        const filePath = '/home/shandori/code/proj/models/A.php:675'
        renderWithEditor(filePath, 200, { opened: true, folder: '/home/shandori/code/proj' })
        const link = screen.getByRole('link', { name: filePath })

        fireEvent.click(link)

        await waitFor(() => expect(openSpy).toHaveBeenCalledWith(
            'https://code.local/?folder=/home/shandori/code/proj/models#hapi-focus',
            'hapi-code-home-shandori-code-proj-models'
        ))
        // No navigation of the loaded tab, no closing: the mock tab starts
        // at about:blank only in jsdom, the folder URL came via window.open.
        expect((openSpy.mock.results[0]?.value as { close: () => void }).close).not.toHaveBeenCalled()
        expect(globalThis.fetch).toHaveBeenCalledWith(
            '/api/sessions/session-1/editor-open',
            expect.objectContaining({ method: 'POST' })
        )
    })

    it('navigates the same tab to the payload URL when no window holds the project', async () => {
        const filePath = '/home/shandori/code/proj/models/A.php:675'
        renderWithEditor(filePath, 404, { error: 'No editor window holds this project', code: 'no-window' })
        const link = screen.getByRole('link', { name: filePath })

        fireEvent.click(link)

        await waitFor(() => expect(openSpy).toHaveBeenCalledWith(
            'https://code.local/?folder=/home/shandori/code/proj/models#hapi-focus',
            'hapi-code-home-shandori-code-proj-models'
        ))
        await waitFor(() => {
            const href = (openSpy.mock.results[0]?.value as { location: { href: string } }).location.href
            expect(href.startsWith('https://code.local/?folder=')).toBe(true)
            expect(href).toContain('&payload=')
        })
        const href = (openSpy.mock.results[0]?.value as { location: { href: string } }).location.href
        const parsed = new URL(href)
        expect(parsed.searchParams.get('folder')).toBe('/home/shandori/code/proj/models')
    })
})
