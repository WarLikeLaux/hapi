import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { I18nProvider } from '@/lib/i18n-context'
import { ResponseChanges } from './ResponseChanges'

afterEach(() => cleanup())

describe('ResponseChanges', () => {
    it('shows per-step stats and opens the persisted unified diff', () => {
        render(
            <I18nProvider>
                <ResponseChanges changes={{
                    diff: 'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+new\n',
                    filesChanged: 1,
                    additions: 1,
                    deletions: 1,
                }} />
            </I18nProvider>
        )

        const button = screen.getByRole('button', { name: 'Show changes' })
        const fileCount = screen.getByText('· 1')
        expect(fileCount).toHaveClass('hidden', 'sm:inline')
        expect(button).toHaveTextContent('+1')
        expect(button).toHaveTextContent('−1')

        fireEvent.click(button)

        expect(screen.getByRole('dialog')).toBeInTheDocument()
        expect(screen.getByText('Changes in this step')).toBeInTheDocument()
        expect(screen.getByText('+new')).toBeInTheDocument()
        expect(screen.getByText('-old')).toBeInTheDocument()
    })

    it('keeps the summary available when the stored diff exceeded the limit', () => {
        render(
            <I18nProvider>
                <ResponseChanges changes={{
                    diff: null,
                    filesChanged: 4,
                    additions: 500,
                    deletions: 20,
                    truncated: true,
                }} />
            </I18nProvider>
        )

        fireEvent.click(screen.getByRole('button', { name: 'Show changes' }))

        expect(screen.getByText(/diff is too large/i)).toBeInTheDocument()
        expect(screen.getByText('Files: 4')).toBeInTheDocument()
    })
})
