import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ExternalMessageText } from './ExternalMessageText'

describe('ExternalMessageText', () => {
    it('renders messenger punctuation literally instead of guessing Markdown', () => {
        const { container } = render(<ExternalMessageText text={'*asterisks* and _underscores_\nnext line'} />)

        expect(screen.getByText(/\*asterisks\* and _underscores_/)).toBeInTheDocument()
        expect(container.querySelector('em')).toBeNull()
        expect(container.querySelector('strong')).toBeNull()
    })
})
