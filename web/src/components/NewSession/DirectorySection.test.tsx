import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { getProjectLabelHue } from '@/components/SessionRowSummary'
import { DirectorySection } from './DirectorySection'

vi.mock('@/lib/use-translation', () => ({
    useTranslation: () => ({ t: (key: string) => key })
}))

describe('DirectorySection', () => {
    it('stretches the Browse button to the directory input height', () => {
        render(
            <DirectorySection
                directory=""
                suggestions={[]}
                selectedIndex={0}
                isDisabled={false}
                workPaths={[]}
                recentPaths={[]}
                onDirectoryChange={vi.fn()}
                onDirectoryFocus={vi.fn()}
                onDirectoryBlur={vi.fn()}
                onDirectoryKeyDown={vi.fn()}
                onSuggestionSelect={vi.fn()}
                onPathClick={vi.fn()}
                onChooseFolder={vi.fn()}
            />
        )

        expect(screen.getByRole('button', { name: 'newSession.browse' })).toHaveClass('self-stretch')
    })

    it('shows the last two path segments while preserving the full path on click', () => {
        const onPathClick = vi.fn()
        const path = 'C:\\Users\\Ananovo\\Downloads\\Agent\\Hapi'

        render(
            <DirectorySection
                directory=""
                suggestions={[]}
                selectedIndex={0}
                isDisabled={false}
                workPaths={[]}
                recentPaths={[path]}
                onDirectoryChange={vi.fn()}
                onDirectoryFocus={vi.fn()}
                onDirectoryBlur={vi.fn()}
                onDirectoryKeyDown={vi.fn()}
                onSuggestionSelect={vi.fn()}
                onPathClick={onPathClick}
            />
        )

        const recentPath = screen.getByRole('button', { name: path })
        expect(recentPath).toHaveTextContent('Agent/Hapi')
        expect(recentPath).toHaveAttribute('title', path)

        fireEvent.click(recentPath)
        expect(onPathClick).toHaveBeenCalledWith(path)
    })

    it('colors recent path chips with the same project hue as the session list', () => {
        const path = '/home/user/code/hapi'
        const hue = getProjectLabelHue(path)

        render(
            <DirectorySection
                directory=""
                suggestions={[]}
                selectedIndex={0}
                isDisabled={false}
                workPaths={[]}
                recentPaths={[path]}
                onDirectoryChange={vi.fn()}
                onDirectoryFocus={vi.fn()}
                onDirectoryBlur={vi.fn()}
                onDirectoryKeyDown={vi.fn()}
                onSuggestionSelect={vi.fn()}
                onPathClick={vi.fn()}
            />
        )

        const recentPath = screen.getByRole('button', { name: path })
        const style = recentPath.getAttribute('style') ?? ''
        expect(style).toContain(`hsl(${hue} 78% 27%)`)
        expect(style).toContain(`hsl(${hue} 68% 30%)`)
    })

    it('renders separate Working and Recent rows with their own labels', () => {
        const workPath = '/code/corp-api'
        const recentPath = '/code/side-thing'

        render(
            <DirectorySection
                directory=""
                suggestions={[]}
                selectedIndex={0}
                isDisabled={false}
                workPaths={[workPath]}
                recentPaths={[recentPath]}
                onDirectoryChange={vi.fn()}
                onDirectoryFocus={vi.fn()}
                onDirectoryBlur={vi.fn()}
                onDirectoryKeyDown={vi.fn()}
                onSuggestionSelect={vi.fn()}
                onPathClick={vi.fn()}
            />
        )

        expect(screen.getByRole('button', { name: workPath })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: recentPath })).toBeInTheDocument()
        expect(screen.getByText('newSession.working:')).toBeInTheDocument()
        expect(screen.getByText('newSession.recent:')).toBeInTheDocument()
    })

    it('hides a row when its list is empty', () => {
        render(
            <DirectorySection
                directory=""
                suggestions={[]}
                selectedIndex={0}
                isDisabled={false}
                workPaths={[]}
                recentPaths={['/code/x']}
                onDirectoryChange={vi.fn()}
                onDirectoryFocus={vi.fn()}
                onDirectoryBlur={vi.fn()}
                onDirectoryKeyDown={vi.fn()}
                onSuggestionSelect={vi.fn()}
                onPathClick={vi.fn()}
            />
        )

        expect(screen.queryByText('newSession.working:')).not.toBeInTheDocument()
        expect(screen.getByText('newSession.recent:')).toBeInTheDocument()
    })
})