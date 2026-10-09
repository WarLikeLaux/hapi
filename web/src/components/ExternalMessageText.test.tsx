import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ExternalMessageText } from './ExternalMessageText'

describe('ExternalMessageText', () => {
    it('preserves provider link labels after emoji and leaves unsafe targets as text', () => {
        render(<ExternalMessageText
            text="🤖 Отсюда и плохая ссылка"
            textLinks={[
                { offset: 3, length: 6, url: 'https://example.com/story' },
                { offset: 12, length: 13, url: 'javascript:alert(1)' }
            ]}
        />)
        expect(screen.getByRole('link', { name: 'Отсюда' })).toHaveAttribute('href', 'https://example.com/story')
        expect(screen.getAllByRole('link')).toHaveLength(1)
        expect(screen.getByText(/плохая ссылка/)).toBeInTheDocument()
    })

    it('renders messenger punctuation literally instead of guessing Markdown', () => {
        const { container } = render(<ExternalMessageText text={'*asterisks* and _underscores_\nnext line'} />)

        expect(screen.getByText(/\*asterisks\* and _underscores_/)).toBeInTheDocument()
        expect(container.querySelector('em')).toBeNull()
        expect(container.querySelector('strong')).toBeNull()
    })
})
