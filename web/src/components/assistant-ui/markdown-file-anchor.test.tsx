import { render, screen } from '@testing-library/react'
import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { defaultComponents, UriConfirmProvider } from '@/components/assistant-ui/markdown-text'
import { I18nProvider } from '@/lib/i18n-context'
import { encodeBase64 } from '@/lib/utils'

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
