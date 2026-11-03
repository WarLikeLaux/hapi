import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { defaultComponents, UriConfirmProvider } from '@/components/assistant-ui/markdown-text'
import { I18nProvider } from '@/lib/i18n-context'

vi.mock('@/components/AssistantChat/context', () => ({
    useOptionalHappyChatContext: () => ({ sessionId: 'session-1', metadata: { path: '/home/user/project' } }),
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
    it('copies a file path without a line number', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined)
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
        renderFileAnchor('docs/guide.md')
        expect(screen.queryByRole('link')).toBeNull()
        fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
        await waitFor(() => expect(writeText).toHaveBeenCalledWith('docs/guide.md'))
    })

    it('copies the project-relative file reference instead of its abbreviated label', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined)
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
        render(<I18nProvider><UriConfirmProvider><AnchorComponent href="hapi-file:%2Fhome%2Fuser%2Fproject%2Fsrc%2Fapp.ts%23L42C7">app.ts</AnchorComponent></UriConfirmProvider></I18nProvider>)
        expect(screen.queryByRole('link')).toBeNull()
        fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
        await waitFor(() => expect(writeText).toHaveBeenCalledWith('src/app.ts:42:7'))
    })

})
