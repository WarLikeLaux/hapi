import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, expect, it, vi } from 'vitest'
import type { SessionSummary } from '@/types/api'
import { I18nProvider } from '@/lib/i18n-context'
import { ToastProvider } from '@/lib/toast-context'
import { AppContextTestProvider } from '@/test/app-context'
import { SessionList } from './SessionList'

vi.mock('@tanstack/react-router', async (importOriginal) => ({
    ...await importOriginal<typeof import('@tanstack/react-router')>(),
    useNavigate: () => vi.fn(),
    useParams: () => ({}),
}))

afterEach(() => { cleanup(); localStorage.clear() })

function session(id: string, parked: boolean, index: number): SessionSummary {
    return {
        id, active: false, thinking: false, activeAt: 0, updatedAt: 10_000 - index,
        lastAgentMessageAt: 10_000 - index, contentRevision: 1, hasConversationContent: true,
        metadata: { path: '/work/project-hidden', name: id, lifecycleState: parked ? 'parked' : 'archived' },
        metadataVersion: 0, agentStateVersion: 0, todosUpdatedAt: 0, todoProgress: null,
        pendingRequestsCount: 0, pendingRequestKinds: [], pendingRequests: [], backgroundTaskCount: 0,
        futureScheduledMessageCount: 0, nextScheduledAt: null, model: null, effort: null,
    }
}

it('hides projects, shows all parked chats, and paginates recent chats', () => {
    const sessions = [
        ...Array.from({ length: 8 }, (_, i) => session(`Recent ${i + 1}`, false, i)),
        ...Array.from({ length: 8 }, (_, i) => session(`Parked ${i + 1}`, true, i)),
    ]
    const client = new QueryClient()
    render(<QueryClientProvider client={client}><ToastProvider><I18nProvider><AppContextTestProvider>
        <SessionList sessions={sessions} onSelect={vi.fn()} onNewSession={vi.fn()} onRefresh={vi.fn()}
            isLoading={false} api={null} renderHeader={false} />
    </AppContextTestProvider></I18nProvider></ToastProvider></QueryClientProvider>)

    expect(screen.queryByTitle('/work/project-hidden')).toBeNull()
    const parked = within(screen.getByRole('region', { name: 'Parked' }))
    expect(parked.getByRole('button', { name: /Parked 5/ })).toBeVisible()
    expect(parked.getByRole('button', { name: /Parked 8/ })).toBeVisible()
    expect(parked.queryByRole('button', { name: /Expand/ })).toBeNull()
    fireEvent.click(parked.getByRole('button', { name: 'Parked' }))
    expect(parked.getByRole('button', { name: 'Parked' })).toHaveAttribute('aria-expanded', 'false')

    const recentToggle = screen.getByRole('button', { name: 'Toggle recent history' })
    expect(recentToggle.textContent).not.toMatch(/\(8\)/)
    fireEvent.click(recentToggle)
    const recent = within(recentToggle.parentElement!)
    expect(recent.getByRole('button', { name: /Recent 5/ })).toBeVisible()
    expect(recent.queryByRole('button', { name: /Recent 6/ })).toBeNull()
    fireEvent.click(recent.getByRole('button', { name: 'Expand 3' }))
    expect(recent.getByRole('button', { name: /Recent 8/ })).toBeVisible()
    fireEvent.click(recent.getByRole('button', { name: 'Collapse 3' }))
    expect(recent.queryByRole('button', { name: /Recent 6/ })).toBeNull()
})

it('finds an older chat without project folders', () => {
    const sessions = Array.from({ length: 8 }, (_, i) => session(`Recent ${i + 1}`, false, i))
    const client = new QueryClient()
    render(<QueryClientProvider client={client}><ToastProvider><I18nProvider><AppContextTestProvider>
        <SessionList sessions={sessions} onSelect={vi.fn()} onNewSession={vi.fn()} onRefresh={vi.fn()}
            isLoading={false} api={null} renderHeader={false} />
    </AppContextTestProvider></I18nProvider></ToastProvider></QueryClientProvider>)
    fireEvent.click(screen.getByRole('button', { name: /Search sessions/ }))
    fireEvent.change(screen.getByPlaceholderText('Search title/path/Agent/machine/ID…'), { target: { value: 'Recent 8' } })
    expect(screen.getByRole('button', { name: /Recent 8/ })).toBeVisible()
    expect(screen.queryByTitle('/work/project-hidden')).toBeNull()
})

it('can restore project folders when the preference is enabled', () => {
    localStorage.setItem('hapi-show-project-groups', 'true')
    const client = new QueryClient()
    render(<QueryClientProvider client={client}><ToastProvider><I18nProvider><AppContextTestProvider>
        <SessionList sessions={[session('Recent', false, 1)]} onSelect={vi.fn()} onNewSession={vi.fn()} onRefresh={vi.fn()}
            isLoading={false} api={null} renderHeader={false} />
    </AppContextTestProvider></I18nProvider></ToastProvider></QueryClientProvider>)
    expect(screen.getByTitle('/work/project-hidden')).toBeVisible()
})
