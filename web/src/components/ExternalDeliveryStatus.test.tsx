import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ExternalDeliveryStatus } from './ExternalDeliveryStatus'

describe('ExternalDeliveryStatus', () => {
    it('renders one check for sent and two checks for read', () => {
        const { rerender } = render(<ExternalDeliveryStatus status="sent" />)
        expect(screen.getByRole('img', { name: 'Sent' }).querySelectorAll('path')).toHaveLength(1)
        expect(screen.getByRole('img', { name: 'Sent' }).querySelector('svg')).toHaveClass('h-2.5', 'w-4')

        rerender(<ExternalDeliveryStatus status="read" />)
        expect(screen.getByRole('img', { name: 'Read' }).querySelectorAll('path')).toHaveLength(2)
        expect(screen.getByRole('img', { name: 'Read' }).querySelector('svg')).toHaveClass('h-2.5', 'w-4')
    })
})
