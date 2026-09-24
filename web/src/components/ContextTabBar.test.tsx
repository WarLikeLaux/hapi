import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ContextTabBar } from './ContextTabBar'

vi.mock('@/lib/use-translation', () => ({
    useTranslation: () => ({
        t: (key: string) => {
            const map: Record<string, string> = {
                'sessions.context.tabsLabel': 'Session Contexts',
                'sessions.context.all': 'All',
                'sessions.context.work': 'Work',
                'sessions.context.lab': 'Lab',
                'sessions.context.chill': 'Chill',
            }
            return map[key] ?? key
        }
    })
}))

describe('ContextTabBar', () => {
    const stats = {
        all: { totalCount: 10, activeCount: 3, workingCount: 2, unreadCount: 1 },
        work: { totalCount: 5, activeCount: 2, workingCount: 1, unreadCount: 0 },
        lab: { totalCount: 3, activeCount: 1, workingCount: 1, unreadCount: 1 },
        chill: { totalCount: 2, activeCount: 0, workingCount: 0, unreadCount: 0 },
    }

    it('renders all 4 context tabs with labels and icons', () => {
        const onSelect = vi.fn()
        render(
            <ContextTabBar
                activeContext="all"
                onSelectContext={onSelect}
                stats={stats}
            />
        )

        const tabs = screen.getAllByRole('tab')
        expect(tabs).toHaveLength(4)
        expect(tabs[0]).toHaveTextContent('All')
        expect(tabs[1]).toHaveTextContent('Work')
        expect(tabs[2]).toHaveTextContent('Lab')
        expect(tabs[3]).toHaveTextContent('Chill')
    })

    it('displays working and unread badges and clean title tooltip', () => {
        render(
            <ContextTabBar
                activeContext="all"
                onSelectContext={vi.fn()}
                stats={stats}
            />
        )

        // Multiple tabs have working and unread counts
        expect(screen.getAllByLabelText(/working/i).length).toBeGreaterThan(0)
        expect(screen.getAllByLabelText(/unread/i).length).toBeGreaterThan(0)
        // Chill tab has no working/unread, renders clean label without idle count
        const tabs = screen.getAllByRole('tab')
        expect(tabs[3]).toHaveTextContent('Chill')
        expect(tabs[3]).not.toHaveTextContent('(2)')
        expect(tabs[3]).toHaveAttribute('title', 'Chill (2 total)')
    })

    it('triggers onSelectContext callback when clicked', () => {
        const onSelect = vi.fn()
        render(
            <ContextTabBar
                activeContext="all"
                onSelectContext={onSelect}
                stats={stats}
            />
        )

        const tabs = screen.getAllByRole('tab')
        fireEvent.click(tabs[1]) // Work tab
        expect(onSelect).toHaveBeenCalledWith('work')
    })
})
