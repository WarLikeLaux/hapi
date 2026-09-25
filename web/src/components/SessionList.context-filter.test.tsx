import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import type { SessionSummary } from '@/types/api'
import { I18nProvider } from '@/lib/i18n-context'
import { AppContextTestProvider } from '@/test/app-context'
import { ToastProvider } from '@/lib/toast-context'
import { SessionList } from './SessionList'

afterEach(() => {
    cleanup()
    localStorage.clear()
})

function makeSession(overrides: Partial<SessionSummary> & { id: string }): SessionSummary {
    return {
        active: true,
        thinking: false,
        activeAt: 100,
        updatedAt: 100,
        metadata: null,
        metadataVersion: 0,
        agentStateVersion: 0,
        todosUpdatedAt: 0,
        todoProgress: null,
        pendingRequestsCount: 0,
        pendingRequestKinds: [],
        pendingRequests: [],
        backgroundTaskCount: 0,
        futureScheduledMessageCount: 0,
        nextScheduledAt: null,
        model: null,
        effort: null,
        ...overrides,
    }
}

function renderWithProviders(children: ReactNode) {
    const queryClient = new QueryClient({
        defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false },
        },
    })

    return render(
        <QueryClientProvider client={queryClient}>
            <ToastProvider>
                <I18nProvider>
                    <AppContextTestProvider>{children}</AppContextTestProvider>
                </I18nProvider>
            </ToastProvider>
        </QueryClientProvider>
    )
}

function renderSessionList(sessions: SessionSummary[]) {
    return renderWithProviders(
        <SessionList
            sessions={sessions}
            selectedSessionId={null}
            onSelect={vi.fn()}
            onNewSession={vi.fn()}
            onRefresh={vi.fn()}
            isLoading={false}
            renderHeader={false}
            api={null}
        />
    )
}

const testSessions: SessionSummary[] = [
    makeSession({
        id: 'sess-work-1',
        metadata: {
            path: '/work/internal-service',
            name: 'Fixing backend issue',
            agentSessionId: 'ag-1',
        },
    }),
    makeSession({
        id: 'sess-lab-1',
        metadata: {
            path: '/repos/my-tool',
            name: 'Optimize rendering',
            agentSessionId: 'ag-2',
        },
    }),
    makeSession({
        id: 'sess-chill-1',
        metadata: {
            path: '/home/code',
            name: 'Movie recommendation',
            agentSessionId: 'ag-3',
        },
    }),
]

describe('SessionList Context Filtering', () => {
    beforeEach(() => {
        localStorage.clear()
    })

    it('renders the context tab bar and all sessions in All tab', () => {
        renderSessionList(testSessions)

        const tabs = screen.getAllByRole('tab')
        expect(tabs).toHaveLength(4)

        // All 3 sessions should be in document
        expect(screen.getByText('Fixing backend issue')).toBeInTheDocument()
        expect(screen.getByText('Optimize rendering')).toBeInTheDocument()
        expect(screen.getByText('Movie recommendation')).toBeInTheDocument()
    })

    it('filters sessions when clicking Work tab', () => {
        renderSessionList(testSessions)

        const tabs = screen.getAllByRole('tab')
        fireEvent.click(tabs[1]) // Work

        expect(screen.getByText('Fixing backend issue')).toBeInTheDocument()
        expect(screen.queryByText('Optimize rendering')).toBeNull()
        expect(screen.queryByText('Movie recommendation')).toBeNull()
    })

    it('filters sessions when clicking Lab tab', () => {
        renderSessionList(testSessions)

        const tabs = screen.getAllByRole('tab')
        fireEvent.click(tabs[2]) // Lab

        expect(screen.queryByText('Fixing backend issue')).toBeNull()
        expect(screen.getByText('Optimize rendering')).toBeInTheDocument()
        expect(screen.queryByText('Movie recommendation')).toBeNull()
    })

    it('filters sessions when clicking Chill tab', () => {
        renderSessionList(testSessions)

        const tabs = screen.getAllByRole('tab')
        fireEvent.click(tabs[3]) // Chill

        expect(screen.queryByText('Fixing backend issue')).toBeNull()
        expect(screen.queryByText('Optimize rendering')).toBeNull()
        expect(screen.getByText('Movie recommendation')).toBeInTheDocument()
    })
})
