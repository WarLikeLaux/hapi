import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { I18nProvider } from '@/lib/i18n-context'
import { UnifiedDiffDisplay } from './UnifiedDiffDisplay'

afterEach(() => cleanup())

const TWO_FILE_DIFF = [
    'diff --git a/first.ts b/first.ts',
    '--- a/first.ts',
    '+++ b/first.ts',
    '@@ -1 +1 @@',
    '-old first',
    '+new first',
    'diff --git a/second.ts b/second.ts',
    '--- a/second.ts',
    '+++ b/second.ts',
    '@@ -1 +1 @@',
    '-old second',
    '+new second',
].join('\n')

describe('UnifiedDiffDisplay file sections', () => {
    it('collapses and restores one file without affecting the others', () => {
        render(
            <I18nProvider>
                <UnifiedDiffDisplay diffContent={TWO_FILE_DIFF} showToolbar />
            </I18nProvider>
        )

        const firstToggle = screen.getByRole('button', { name: 'Hide changes in first.ts' })
        expect(firstToggle).toHaveAttribute('aria-expanded', 'true')
        expect(screen.getByText('+new first')).toBeInTheDocument()
        expect(screen.getByText('+new second')).toBeInTheDocument()

        fireEvent.click(firstToggle)

        expect(screen.queryByText('+new first')).not.toBeInTheDocument()
        expect(screen.getByText('+new second')).toBeInTheDocument()
        const expandToggle = screen.getByRole('button', { name: 'Show changes in first.ts' })
        expect(expandToggle).toHaveAttribute('aria-expanded', 'false')

        fireEvent.click(expandToggle)

        expect(screen.getByText('+new first')).toBeInTheDocument()
    })
})
