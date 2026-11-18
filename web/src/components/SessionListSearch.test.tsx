import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/lib/i18n-context'
import { SessionListSearch } from './SessionList'

describe('session list search scope', () => {
    it('can exclude matches without clearing the query', () => {
        const onChange = vi.fn()
        const onExcludeMatchesChange = vi.fn()
        const renderSearch = (excludeMatches: boolean) => (
            <I18nProvider>
                <SessionListSearch
                    value="cache"
                    onChange={onChange}
                    expanded
                    onExpandedChange={vi.fn()}
                    excludeMatches={excludeMatches}
                    onExcludeMatchesChange={onExcludeMatchesChange}
                />
            </I18nProvider>
        )
        const { rerender } = render(renderSearch(false))
        const exclude = screen.getByRole('button', { name: 'Exclude' })
        expect(exclude).toHaveAttribute('aria-pressed', 'false')
        fireEvent.click(exclude)
        expect(onExcludeMatchesChange).toHaveBeenCalledWith(true)
        expect(onChange).not.toHaveBeenCalled()
        rerender(renderSearch(true))
        expect(exclude).toHaveAttribute('aria-pressed', 'true')
        expect(screen.getByRole('searchbox')).toHaveValue('cache')
        fireEvent.click(exclude)
        expect(onExcludeMatchesChange).toHaveBeenLastCalledWith(false)
    })
})
