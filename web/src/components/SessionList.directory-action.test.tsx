import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import type { SessionSummary } from '@/types/api'
import type { ApiClient } from '@/api/client'
import { I18nProvider } from '@/lib/i18n-context'
import { AppContextTestProvider } from '@/test/app-context'
import { ToastProvider } from '@/lib/toast-context'
import { SessionList } from './SessionList'

const SEARCH_LABEL = 'Search sessions (title, path, Agent, machine name, ID, and more)'
const SEARCH_PLACEHOLDER = 'Search title/path/Agent/machine/ID…'

afterEach(() => {
    cleanup()
    localStorage.removeItem('hapi-session-preview-limit')
    localStorage.removeItem('hapi-pin-in-progress-sessions')
})

function makeSession(overrides: Partial<SessionSummary> & { id: string }): SessionSummary {
    return {
        active: false,
        thinking: false,
        activeAt: 0,
        updatedAt: 0,
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
        ...overrides
    }
}

function renderWithProviders(children: ReactNode) {
    const queryClient = new QueryClient({
        defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false },
        }
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

describe('SessionList directory action', () => {


    it('starts a new session with the project machine and directory', () => {
        const onNewSessionInDirectory = vi.fn()
        const session = makeSession({
            id: 'session-1',
            updatedAt: Date.now(),
            metadata: {
                path: '/home/ubuntu',
                machineId: 'machine-1',
                name: 'Greeting',
                flavor: 'codex',
            }
        })

        renderWithProviders(
            <SessionList
                sessions={[session]}
                selectedSessionId={null}
                onSelect={vi.fn()}
                onNewSession={vi.fn()}
                onNewSessionInDirectory={onNewSessionInDirectory}
                onRefresh={vi.fn()}
                isLoading={false}
                renderHeader={false}
                api={null}
                machineLabelsById={{ 'machine-1': 'Mint' }}
            />
        )

        fireEvent.click(screen.getByRole('button', { name: 'New session in this directory' }))

        expect(onNewSessionInDirectory).toHaveBeenCalledWith({
            machineId: 'machine-1',
            directory: '/home/ubuntu',
        })
    })

    it('keeps the sticky project header opaque and aligned with the list viewport', () => {
        const session = makeSession({
            id: 'session-1',
            updatedAt: Date.now(),
            metadata: {
                path: '/home/ubuntu',
                name: 'Greeting',
                flavor: 'codex',
            }
        })

        renderWithProviders(
            <SessionList
                sessions={[session]}
                selectedSessionId={null}
                onSelect={vi.fn()}
                onNewSession={vi.fn()}
                onRefresh={vi.fn()}
                isLoading={false}
                renderHeader={false}
                api={null}
            />
        )

        const projectHeader = screen.getByTitle('/home/ubuntu')
        expect(projectHeader).toHaveClass('bg-[var(--app-bg)]')
        expect(projectHeader).toHaveClass('hover:bg-[var(--app-secondary-bg)]')
        expect(projectHeader).not.toHaveClass('hover:bg-[var(--app-subtle-bg)]')

        const listContent = projectHeader.parentElement?.parentElement
        expect(listContent).not.toHaveClass('pt-1')

        fireEvent.click(screen.getByRole('button', { name: SEARCH_LABEL }))
        const headerRow = screen.getByTestId('session-list-header-row')
        expect(headerRow).toHaveClass('px-2')
        expect(headerRow).toHaveClass('py-1')
        expect(headerRow).toHaveClass('@container')
        expect(headerRow).toHaveClass('flex-nowrap')
        expect(headerRow.className.split(/\s+/)).not.toContain('flex-wrap')
    })

    it('hides the directory action for sessions without path metadata', () => {
        renderWithProviders(
            <SessionList
                sessions={[makeSession({ id: 'session-without-path' })]}
                selectedSessionId={null}
                onSelect={vi.fn()}
                onNewSession={vi.fn()}
                onNewSessionInDirectory={vi.fn()}
                onRefresh={vi.fn()}
                isLoading={false}
                renderHeader={false}
                api={null}
            />
        )

        expect(screen.queryByRole('button', { name: 'New session in this directory' })).toBeNull()
    })

    it('deletes every HAPI session for the right-clicked project and preserves other machines', async () => {
        const onRefresh = vi.fn(async () => {})
        const api = {
            archiveSession: vi.fn(async () => {}),
            deleteSession: vi.fn(async () => {}),
        }
        const activeSession = makeSession({
            id: 'active-session',
            active: true,
            updatedAt: Date.now(),
            metadata: {
                path: '/home/ubuntu/project',
                machineId: 'machine-1',
                name: 'Active work',
                flavor: 'codex',
            },
        })
        const inactiveSession = makeSession({
            id: 'inactive-session',
            updatedAt: Date.now() - 1,
            metadata: {
                path: '/home/ubuntu/project',
                machineId: 'machine-1',
                name: 'Finished work',
                flavor: 'codex',
            },
        })
        const otherMachineSession = makeSession({
            id: 'other-machine-session',
            updatedAt: Date.now() - 2,
            metadata: {
                path: '/home/ubuntu/project',
                machineId: 'machine-2',
                name: 'Other machine',
                flavor: 'codex',
            },
        })

        renderWithProviders(
            <SessionList
                sessions={[activeSession, inactiveSession, otherMachineSession]}
                selectedSessionId={null}
                onSelect={vi.fn()}
                onNewSession={vi.fn()}
                onRefresh={onRefresh}
                isLoading={false}
                renderHeader={false}
                api={api as never}
                machineLabelsById={{ 'machine-1': 'Mint', 'machine-2': 'Desktop' }}
            />
        )

        const mintProjectHeader = screen
            .getAllByTitle('/home/ubuntu/project')
            .find((element) => element.textContent?.includes('Mint'))
        expect(mintProjectHeader).toBeDefined()
        fireEvent.contextMenu(mintProjectHeader!, {
            clientX: 100,
            clientY: 120,
        })
        fireEvent.click(screen.getByRole('menuitem', { name: 'Delete all sessions' }))

        expect(screen.getByRole('heading', { name: 'Delete project sessions?' })).toBeInTheDocument()
        expect(screen.getByText(/Delete all HAPI sessions from “project · Mint”\? Sessions to delete: 2/)).toBeInTheDocument()
        expect(screen.getByText(/Local agent transcripts are kept/)).toBeInTheDocument()

        fireEvent.click(screen.getByRole('button', { name: 'Delete all' }))

        await waitFor(() => {
            expect(api.archiveSession).toHaveBeenCalledTimes(1)
            expect(api.archiveSession).toHaveBeenCalledWith('active-session')
            expect(api.deleteSession).toHaveBeenCalledTimes(2)
            expect(api.deleteSession).toHaveBeenCalledWith('active-session')
            expect(api.deleteSession).toHaveBeenCalledWith('inactive-session')
            expect(api.deleteSession).not.toHaveBeenCalledWith('other-machine-session')
            expect(onRefresh).toHaveBeenCalledTimes(1)
        })
    })
})

describe('SessionList time filter', () => {
    beforeEach(() => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date(2026, 6, 18, 12))
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    it('keeps date controls inside search and retains the chosen range after collapsing', () => {
        const recent = makeSession({
            id: 'recent',
            updatedAt: Date.now(),
            metadata: { path: '/work/recent', name: 'Recent session' }
        })
        const old = makeSession({
            id: 'old',
            updatedAt: new Date(2020, 0, 1).getTime(),
            metadata: { path: '/work/old', name: 'Old session' }
        })

        renderWithProviders(
            <SessionList
                sessions={[recent, old]}
                selectedSessionId={null}
                onSelect={vi.fn()}
                onNewSession={vi.fn()}
                onRefresh={vi.fn()}
                isLoading={false}
                renderHeader={false}
                api={null}
            />
        )

        // Inactive groups start collapsed and do not mount their rows.
        fireEvent.click(screen.getByTitle('/work/recent'))
        fireEvent.click(screen.getByTitle('/work/old'))
        expect(screen.getByRole('button', { name: /Recent session/ })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /Old session/ })).toBeInTheDocument()

        const searchButton = screen.getByRole('button', { name: SEARCH_LABEL })
        expect(screen.queryByRole('button', { name: 'Filter sessions by last activity' })).toBeNull()
        fireEvent.click(searchButton)
        const searchInput = screen.getByPlaceholderText(SEARCH_PLACEHOLDER)
        const filterButton = screen.getByRole('button', { name: 'Filter sessions by last activity' })
        expect(screen.getByTestId('session-list-search')).toContainElement(filterButton)
        expect(screen.getByTestId('session-list-header-row')).toHaveClass('flex-nowrap', '@container')

        fireEvent.click(filterButton)
        const emptyDate = screen.getByRole('button', { name: new Date(2026, 6, 17).toLocaleDateString() })
        const activeDate = screen.getByRole('button', { name: `${new Date(2026, 6, 18).toLocaleDateString()}, has session activity` })
        expect(emptyDate).toHaveClass('text-[var(--app-hint)]')
        expect(activeDate).toHaveClass('text-[var(--app-fg)]')
        expect(activeDate).toHaveAttribute('title', `${new Date(2026, 6, 18).toLocaleDateString()}, has session activity`)
        fireEvent.click(emptyDate)
        fireEvent.click(activeDate)

        expect(screen.getByRole('button', { name: /Recent session/ })).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: /Old session/ })).toBeNull()
        expect(filterButton).toHaveAttribute('title', '2026-07-17 - 2026-07-18')
        expect(filterButton).toHaveAccessibleName('Filter sessions by last activity: 2026-07-17 - 2026-07-18')
        expect(searchInput).toHaveFocus()
        fireEvent.blur(searchInput)
        expect(screen.queryByPlaceholderText(SEARCH_PLACEHOLDER)).toBeNull()
        expect(screen.queryByRole('button', { name: /Filter sessions by last activity/ })).toBeNull()
        expect(screen.queryByRole('button', { name: /Old session/ })).toBeNull()
    })

    it('highlights today without requiring hover or session activity', () => {
        const old = makeSession({
            id: 'old',
            updatedAt: new Date(2020, 0, 1).getTime(),
            metadata: { path: '/work/old', name: 'Old session' }
        })

        renderWithProviders(
            <SessionList
                sessions={[old]}
                selectedSessionId={null}
                onSelect={vi.fn()}
                onNewSession={vi.fn()}
                onRefresh={vi.fn()}
                isLoading={false}
                renderHeader={false}
                api={null}
            />
        )

        fireEvent.click(screen.getByRole('button', { name: SEARCH_LABEL }))
        fireEvent.click(screen.getByRole('button', { name: 'Filter sessions by last activity' }))
        const today = screen.getByRole('button', { name: new Date(2026, 6, 18).toLocaleDateString() })
        const anotherDay = screen.getByRole('button', { name: new Date(2026, 6, 17).toLocaleDateString() })

        expect(today).toHaveClass('bg-[var(--app-subtle-bg)]')
        expect(today).toHaveAttribute('aria-current', 'date')
        expect(anotherDay).not.toHaveAttribute('aria-current')
    })

    it('uses the first calendar click as start and the second as end', () => {
        const session = makeSession({
            id: 'session-1',
            updatedAt: Date.now(),
            metadata: { path: '/work/hapi', name: 'Session' }
        })

        renderWithProviders(
            <SessionList
                sessions={[session]}
                selectedSessionId={null}
                onSelect={vi.fn()}
                onNewSession={vi.fn()}
                onRefresh={vi.fn()}
                isLoading={false}
                renderHeader={false}
                api={null}
            />
        )

        fireEvent.click(screen.getByRole('button', { name: SEARCH_LABEL }))
        const filterButton = screen.getByRole('button', { name: 'Filter sessions by last activity' })
        fireEvent.click(filterButton)
        const startDate = screen.getByRole('button', { name: new Date(2026, 6, 1).toLocaleDateString() })
        fireEvent.click(startDate)
        expect(startDate).toHaveClass('bg-[var(--app-button)]', 'text-[var(--app-button-text)]')
        expect(startDate).not.toHaveClass('text-white')
        expect(screen.getByText('Select end date')).toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: `${new Date(2026, 6, 18).toLocaleDateString()}, has session activity` }))

        expect(filterButton).toHaveAttribute('aria-expanded', 'false')
        expect(filterButton).toHaveAttribute('title', '2026-07-01 - 2026-07-18')
    })

    it('returns focus to the search input after clearing the date range', () => {
        const session = makeSession({
            id: 'session-1',
            updatedAt: Date.now(),
            metadata: { path: '/work/hapi', name: 'Session' }
        })

        renderWithProviders(
            <SessionList
                sessions={[session]}
                selectedSessionId={null}
                onSelect={vi.fn()}
                onNewSession={vi.fn()}
                onRefresh={vi.fn()}
                isLoading={false}
                renderHeader={false}
                api={null}
            />
        )

        fireEvent.click(screen.getByRole('button', { name: SEARCH_LABEL }))
        const input = screen.getByPlaceholderText(SEARCH_PLACEHOLDER)
        const filterButton = screen.getByRole('button', { name: 'Filter sessions by last activity' })
        fireEvent.click(filterButton)
        fireEvent.click(screen.getByRole('button', { name: new Date(2026, 6, 1).toLocaleDateString() }))
        fireEvent.click(screen.getByRole('button', { name: `${new Date(2026, 6, 18).toLocaleDateString()}, has session activity` }))

        // The footer Clear button unmounts with the range; focus must not drop to body.
        fireEvent.click(filterButton)
        fireEvent.click(screen.getByRole('button', { name: 'Clear' }))

        expect(input).toHaveFocus()
        expect(filterButton).toHaveAttribute('title', 'Filter sessions by last activity')
    })
})

describe('SessionList action menu parity', () => {
    it.each([
        ['running', true],
        ['closed', false]
    ] as const)('hides conversation export for a %s session', (_label, active) => {
        const session = makeSession({
            id: `session-${active ? 'running' : 'closed'}`,
            active,
            updatedAt: Date.now(),
            metadata: {
                path: '/home/ubuntu',
                machineId: 'machine-1',
                name: active ? 'Running session' : 'Closed session',
                flavor: 'codex'
            }
        })

        renderWithProviders(
            <SessionList
                sessions={[session]}
                selectedSessionId={null}
                onSelect={vi.fn()}
                onNewSession={vi.fn()}
                onRefresh={vi.fn()}
                isLoading={false}
                renderHeader={false}
                api={null}
            />
        )

        if (!active) {
            fireEvent.click(screen.getByTitle('/home/ubuntu'))
        }
        fireEvent.contextMenu(screen.getByRole('button', { name: new RegExp(active ? 'Running session' : 'Closed session') }))
        expect(screen.queryByRole('menuitem', { name: 'Export conversation' })).toBeNull()
    })
})

describe('SessionList fork session action', () => {
    it('forks a supported active session from the menu and opens the child', async () => {
        const forkConversation = vi.fn(async () => ({ sessionId: 'child-session' }))
        const onSelect = vi.fn()
        const session = makeSession({
            id: 'source-session',
            active: true,
            updatedAt: Date.now(),
            metadata: {
                path: '/work/source',
                name: 'Source session',
                flavor: 'codex',
                conversationHistory: { forkCurrent: true, forkAtMessage: true },
            },
        })
        renderWithProviders(<SessionList sessions={[session]} selectedSessionId={session.id} onSelect={onSelect}
            onNewSession={vi.fn()} onRefresh={vi.fn()} isLoading={false} renderHeader={false}
            api={{ forkConversation } as unknown as ApiClient} />)

        fireEvent.contextMenu(screen.getByRole('button', { name: /Source session/ }))
        fireEvent.click(screen.getByRole('menuitem', { name: 'Fork session' }))
        const dialog = screen.getByRole('dialog')
        expect(within(dialog).getByRole('heading', { name: 'Fork session' })).toBeInTheDocument()
        fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }))

        await waitFor(() => expect(forkConversation).toHaveBeenCalledWith('source-session'))
        expect(onSelect).toHaveBeenCalledWith('child-session')
    })

    it('keeps Fork session disabled while the source turn is running', () => {
        const session = makeSession({
            id: 'running-source',
            active: true,
            thinking: true,
            metadata: {
                path: '/work/running',
                name: 'Running source',
                flavor: 'codex',
                conversationHistory: { forkCurrent: true },
            },
        })
        renderWithProviders(<SessionList sessions={[session]} selectedSessionId={null} onSelect={vi.fn()}
            onNewSession={vi.fn()} onRefresh={vi.fn()} isLoading={false} renderHeader={false}
            api={{ forkConversation: vi.fn() } as unknown as ApiClient} />)

        fireEvent.contextMenu(screen.getByRole('button', { name: /Running source/ }))
        expect(screen.getByRole('menuitem', { name: 'Fork session' })).toHaveAttribute('aria-disabled', 'true')
        expect(screen.queryByRole('dialog')).toBeNull()
    })

    it('hides Fork session for locally controlled sessions', () => {
        const session = {
            ...makeSession({
                id: 'locally-controlled',
                active: true,
                metadata: {
                    path: '/work/local',
                    name: 'Locally controlled session',
                    flavor: 'claude',
                    conversationHistory: { forkCurrent: true },
                },
            }),
            agentState: { controlledByUser: true, requests: {} },
        } as SessionSummary
        renderWithProviders(<SessionList sessions={[session]} selectedSessionId={null} onSelect={vi.fn()}
            onNewSession={vi.fn()} onRefresh={vi.fn()} isLoading={false} renderHeader={false}
            api={{ forkConversation: vi.fn() } as unknown as ApiClient} />)

        fireEvent.contextMenu(screen.getByRole('button', { name: /Locally controlled session/ }))
        expect(screen.queryByRole('menuitem', { name: 'Fork session' })).toBeNull()
    })

    it('hides Fork session when the active session does not advertise current-fork support', () => {
        const session = makeSession({
            id: 'unsupported-source',
            active: true,
            metadata: { path: '/work/unsupported', name: 'Unsupported source', flavor: 'gemini' },
        })
        renderWithProviders(<SessionList sessions={[session]} selectedSessionId={null} onSelect={vi.fn()}
            onNewSession={vi.fn()} onRefresh={vi.fn()} isLoading={false} renderHeader={false}
            api={{ forkConversation: vi.fn() } as unknown as ApiClient} />)

        fireEvent.contextMenu(screen.getByRole('button', { name: /Unsupported source/ }))
        expect(screen.queryByRole('menuitem', { name: 'Fork session' })).toBeNull()
    })

    it('forks an archived Codex session directly from the list menu', async () => {
        const forkConversation = vi.fn(async () => ({ sessionId: 'archived-child' }))
        const onSelect = vi.fn()
        const session = makeSession({
            id: 'archived-source',
            active: false,
            metadata: {
                path: '/work/archived',
                machineId: 'machine-1',
                name: 'Archived source',
                flavor: 'codex',
                lifecycleState: 'archived',
                agentSessionId: 'native-source',
            },
        })
        renderWithProviders(<SessionList sessions={[session]} selectedSessionId={null} onSelect={onSelect}
            onNewSession={vi.fn()} onRefresh={vi.fn()} isLoading={false} renderHeader={false}
            api={{ forkConversation } as unknown as ApiClient} />)

        fireEvent.click(screen.getByTitle('/work/archived'))
        fireEvent.contextMenu(screen.getByRole('button', { name: /Archived source/ }))
        fireEvent.click(screen.getByRole('menuitem', { name: 'Fork session' }))
        const dialog = screen.getByRole('dialog')
        fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }))

        await waitFor(() => expect(forkConversation).toHaveBeenCalledWith('archived-source'))
        expect(onSelect).toHaveBeenCalledWith('archived-child')
    })

    it('keeps the dialog open and reports a fork failure without navigating', async () => {
        const forkConversation = vi.fn(async () => { throw new Error('fork failed') })
        const onSelect = vi.fn()
        const session = makeSession({
            id: 'failing-source',
            active: true,
            metadata: {
                path: '/work/failing',
                name: 'Failing source',
                flavor: 'codex',
                conversationHistory: { forkCurrent: true },
            },
        })
        renderWithProviders(<SessionList sessions={[session]} selectedSessionId={null} onSelect={onSelect}
            onNewSession={vi.fn()} onRefresh={vi.fn()} isLoading={false} renderHeader={false}
            api={{ forkConversation } as unknown as ApiClient} />)

        fireEvent.contextMenu(screen.getByRole('button', { name: /Failing source/ }))
        fireEvent.click(screen.getByRole('menuitem', { name: 'Fork session' }))
        const dialog = screen.getByRole('dialog')
        fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }))

        await waitFor(() => expect(within(dialog).getByText('fork failed')).toBeInTheDocument())
        expect(onSelect).not.toHaveBeenCalled()
        expect(dialog).toBeInTheDocument()
    })
})

describe('SessionList selection', () => {
    it('does not select the row that moves under the pointer during a live reorder', () => {
        const onSelect = vi.fn()
        const first = makeSession({
            id: 'session-first',
            active: true,
            updatedAt: 200,
            lastUserMessageAt: 200,
            metadata: { path: '/work/hapi', name: 'First session', flavor: 'codex' }
        })
        const second = makeSession({
            id: 'session-second',
            active: true,
            updatedAt: 100,
            lastUserMessageAt: 100,
            metadata: { path: '/work/hapi', name: 'Second session', flavor: 'codex' }
        })

        const renderList = (sessions: SessionSummary[]) => (
            <QueryClientProvider client={new QueryClient()}>
                <ToastProvider>
                    <I18nProvider>
                        <AppContextTestProvider>
                        <SessionList
                            sessions={sessions}
                            selectedSessionId={null}
                            onSelect={onSelect}
                            onNewSession={vi.fn()}
                            onRefresh={vi.fn()}
                            isLoading={false}
                            renderHeader={false}
                            api={null}
                        />
                        </AppContextTestProvider>
                    </I18nProvider>
                </ToastProvider>
            </QueryClientProvider>
        )

        const { rerender } = render(renderList([first, second]))
        fireEvent.mouseDown(screen.getByRole('button', { name: /First session/ }), { button: 0 })

        rerender(renderList([
            { ...first, updatedAt: 200 },
            { ...second, updatedAt: 300, lastUserMessageAt: 300 }
        ]))

        fireEvent.mouseUp(screen.getByRole('button', { name: /Second session/ }), { button: 0 })

        expect(onSelect).not.toHaveBeenCalled()
    })
})

describe('SessionList collapse behavior', () => {
    function renderSessionList(sessions: SessionSummary[], selectedSessionId: string | null = 'session-running') {
        return (
            <QueryClientProvider client={new QueryClient({
                defaultOptions: {
                    queries: { retry: false },
                    mutations: { retry: false },
                }
            })}>
                <ToastProvider>
                    <I18nProvider>
                        <AppContextTestProvider>
                            <SessionList
                                sessions={sessions}
                                selectedSessionId={selectedSessionId}
                                onSelect={vi.fn()}
                                onNewSession={vi.fn()}
                                onRefresh={vi.fn()}
                                isLoading={false}
                                renderHeader={false}
                                api={null}
                            />
                        </AppContextTestProvider>
                    </I18nProvider>
                </ToastProvider>
            </QueryClientProvider>
        )
    }

    function getProjectPanel(): Element {
        const header = screen.getByTitle('/work/hapi')
        const panel = header.nextElementSibling
        if (!panel) {
            throw new Error('Expected project collapse panel')
        }
        return panel
    }

    it('keeps a selected running path collapsed across live session-list refreshes', async () => {
        localStorage.setItem('hapi-pin-in-progress-sessions', 'true')
        const baseSessions = [
            makeSession({
                id: 'session-running',
                active: true,
                thinking: true,
                pendingRequestsCount: 1,
                updatedAt: 100,
                metadata: { path: '/work/hapi', name: 'Running task', flavor: 'codex' },
            }),
            makeSession({
                id: 'session-old',
                updatedAt: 50,
                metadata: { path: '/work/hapi', name: 'Older task', flavor: 'codex' },
            })
        ]
        const { rerender } = render(renderSessionList(baseSessions))

        // The running session is pinned in the "in progress" section; the
        // directory group now only holds inactive sessions and starts
        // collapsed.
        expect(getProjectPanel().getAttribute('data-open')).toBeNull()

        rerender(renderSessionList([
            {
                ...baseSessions[0]!,
                pendingRequestsCount: 2,
                updatedAt: 200,
            },
            baseSessions[1]!
        ]))

        await waitFor(() => {
            expect(getProjectPanel().getAttribute('data-open')).toBeNull()
        })
    })

    it('leaves active sessions in directory groups when pin-in-progress is off', () => {
        localStorage.setItem('hapi-pin-in-progress-sessions', 'false')
        const sessions = [
            makeSession({
                id: 'session-running',
                active: true,
                thinking: true,
                updatedAt: 100,
                metadata: { path: '/work/hapi', name: 'Running task', flavor: 'codex' },
            }),
            makeSession({
                id: 'session-idle',
                updatedAt: 50,
                metadata: { path: '/work/other', name: 'Other task', flavor: 'codex' },
            }),
        ]
        render(renderSessionList(sessions, null))

        expect(screen.queryByTitle('Active sessions')).toBeNull()
        expect(screen.getByTitle('/work/hapi')).toBeInTheDocument()
        fireEvent.click(screen.getByTitle('/work/hapi'))
        expect(screen.getByRole('button', { name: /Running task/ })).toBeInTheDocument()
        expect(screen.getByTitle('/work/hapi').nextElementSibling?.getAttribute('data-open')).toBe('true')
    })

    it('floats working sessions into the compact Working section', () => {
        localStorage.setItem('hapi-pin-in-progress-sessions', 'true')
        const sessions = [
            makeSession({
                id: 'session-running',
                active: true,
                thinking: true,
                updatedAt: 100,
                metadata: { path: '/work/hapi', name: 'Running task', flavor: 'codex' },
            }),
            makeSession({
                id: 'session-idle',
                updatedAt: 50,
                metadata: { path: '/work/hapi', name: 'Idle task', flavor: 'codex' },
            }),
        ]
        render(renderSessionList(sessions, null))

        expect(screen.getByTitle('Working sessions')).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /Running task/ })).toBeInTheDocument()
        // Directory group retains only the inactive session.
        expect(getProjectPanel().getAttribute('data-open')).toBeNull()
    })

    it('floats project-pinned working sessions into the Working section', () => {
        localStorage.setItem('hapi-pin-in-progress-sessions', 'true')
        const sessions = [
            makeSession({
                id: 'session-pinned-running',
                active: true,
                thinking: true,
                pinned: true,
                updatedAt: 100,
                metadata: { path: '/work/hapi', name: 'Pinned running task', flavor: 'codex' },
            }),
            makeSession({
                id: 'session-idle',
                updatedAt: 50,
                metadata: { path: '/work/hapi', name: 'Idle task', flavor: 'codex' },
            }),
        ]
        render(renderSessionList(sessions, null))

        expect(screen.getByTitle('Working sessions')).toBeInTheDocument()
        expect(getProjectPanel().getAttribute('data-open')).toBeNull()
        expect(screen.getByRole('button', { name: /Pinned running task/ })).toBeInTheDocument()
    })

    it('keeps pinned and Working sections above collapsed project history', () => {
        localStorage.setItem('hapi-pin-in-progress-sessions', 'true')
        const sessions = [
            makeSession({
                id: 'session-global',
                globalPinned: true,
                updatedAt: 300,
                metadata: { path: '/work/global', name: 'Global pin', flavor: 'codex' },
            }),
            makeSession({
                id: 'session-project-pin',
                pinned: true,
                updatedAt: 100,
                metadata: { path: '/work/pinned-project', name: 'Project pin', flavor: 'codex' },
            }),
            makeSession({
                id: 'session-project-idle',
                updatedAt: 200,
                metadata: { path: '/work/pinned-project', name: 'Project idle', flavor: 'codex' },
            }),
            makeSession({
                id: 'session-floater',
                active: true,
                thinking: true,
                updatedAt: 250,
                metadata: { path: '/work/other', name: 'Unpinned floater', flavor: 'codex' },
            }),
            makeSession({
                id: 'session-idle-other',
                updatedAt: 50,
                metadata: { path: '/work/other', name: 'Other idle', flavor: 'codex' },
            }),
        ]
        render(renderSessionList(sessions, null))

        const globalSection = screen.getByTitle('Pinned sessions')
        const working = screen.getByTitle('Working sessions')
        const projectPinGroup = screen.getByTitle('/work/pinned-project')
        const otherGroup = screen.getByTitle('/work/other')

        expect(globalSection).toAppearBefore(working)
        expect(working).toAppearBefore(projectPinGroup)
        expect(projectPinGroup).toAppearBefore(otherGroup)
        expect(screen.getByRole('button', { name: /Unpinned floater/ })).toBeInTheDocument()
        fireEvent.click(projectPinGroup)
        expect(screen.getByRole('button', { name: /Project pin/ })).toAppearBefore(
            screen.getByRole('button', { name: /Project idle/ })
        )
    })

    it('does not label quiet active sessions as Idle', () => {
        const sessions = [
            makeSession({
                id: 'session-quiet',
                active: true,
                updatedAt: 100,
                metadata: { path: '/work/hapi', name: 'Quiet task', flavor: 'codex' },
            }),
        ]
        render(renderSessionList(sessions, null))

        expect(screen.getByRole('button', { name: /Quiet task/ })).toBeInTheDocument()
        expect(screen.queryByText('Idle')).toBeNull()
        expect(screen.queryByTitle('Idle')).toBeNull()
    })

    it('keeps quiet active sessions in the Active section when pin-in-progress is on', () => {
        localStorage.setItem('hapi-pin-in-progress-sessions', 'true')
        const sessions = [
            makeSession({
                id: 'session-running',
                active: true,
                thinking: true,
                updatedAt: 100,
                metadata: { path: '/work/hapi', name: 'Running task', flavor: 'codex' },
            }),
            makeSession({
                id: 'session-quiet',
                active: true,
                updatedAt: 90,
                metadata: { path: '/work/hapi', name: 'Quiet task', flavor: 'codex' },
            }),
            makeSession({
                id: 'session-pending',
                active: true,
                pendingRequestsCount: 1,
                updatedAt: 80,
                metadata: { path: '/work/other', name: 'Pending task', flavor: 'codex' },
            }),
        ]
        render(renderSessionList(sessions, null))

        expect(screen.getByTitle('Working sessions')).toHaveTextContent('(1)')
        expect(screen.getByTitle('Active sessions')).toBeInTheDocument()
        expect(screen.getByTitle('Active sessions')).toHaveTextContent('(2)')
        expect(screen.getByRole('button', { name: /Running task/ })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /Pending task/ })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /Quiet task/ })).toBeInTheDocument()
        expect(screen.queryByTitle('/work/hapi')).toBeNull()
        expect(screen.queryByTitle('/work/other')).toBeNull()
    })

    it('does not leave a dangling project row when every session floated', () => {
        localStorage.setItem('hapi-pin-in-progress-sessions', 'true')
        const onNewSessionInDirectory = vi.fn()
        const sessions = [
            makeSession({
                id: 'session-quiet',
                active: true,
                updatedAt: 100,
                metadata: { path: '/work/hapi', machineId: 'machine-1', name: 'Quiet task', flavor: 'codex' },
            }),
        ]
        renderWithProviders(
            <SessionList
                sessions={sessions}
                selectedSessionId={null}
                onSelect={vi.fn()}
                onNewSession={vi.fn()}
                onRefresh={vi.fn()}
                isLoading={false}
                renderHeader={false}
                api={null}
                onNewSessionInDirectory={onNewSessionInDirectory}
            />
        )

        expect(screen.getByTitle('Active sessions')).toBeInTheDocument()
        expect(screen.queryByTitle('/work/hapi')).toBeNull()
        expect(screen.queryByRole('button', { name: 'New session in this directory' })).toBeNull()
        expect(onNewSessionInDirectory).not.toHaveBeenCalled()
    })

    it('auto-expands the path again when the selected session changes', async () => {
        const sessions = [
            makeSession({
                id: 'session-first',
                updatedAt: 100,
                metadata: { path: '/work/hapi', name: 'Running task', flavor: 'codex' },
            }),
            makeSession({
                id: 'session-next',
                updatedAt: 90,
                metadata: { path: '/work/hapi', name: 'Next task', flavor: 'codex' },
            })
        ]
        const { rerender } = render(renderSessionList(sessions))

        // Inactive-only groups start collapsed; selecting a session inside
        // one auto-expands it.
        expect(getProjectPanel().getAttribute('data-open')).toBeNull()

        rerender(renderSessionList([
            ...sessions,
            makeSession({
                id: 'session-running',
                active: true,
                thinking: true,
                updatedAt: 110,
                metadata: { path: '/work/hapi', name: 'Running task', flavor: 'codex' },
            }),
        ], 'session-next'))

        await waitFor(() => {
            expect(getProjectPanel().getAttribute('data-open')).toBe('true')
        })
    })

    it('keeps an inactive project-pinned group collapsed with no selection', () => {
        const sessions = [
            makeSession({
                id: 'session-pinned',
                pinned: true,
                updatedAt: 100,
                metadata: { path: '/work/hapi', name: 'Pinned task', flavor: 'codex' },
            }),
            makeSession({
                id: 'session-idle',
                updatedAt: 50,
                metadata: { path: '/work/hapi', name: 'Idle task', flavor: 'codex' },
            }),
        ]
        render(renderSessionList(sessions, null))

        expect(getProjectPanel().getAttribute('data-open')).toBeNull()
        fireEvent.click(screen.getByTitle('/work/hapi'))
        expect(screen.getByRole('button', { name: /Pinned task/ })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /Idle task/ })).toBeInTheDocument()
    })

    it('keeps the Active section visible and non-collapsible', () => {
        localStorage.setItem('hapi-pin-in-progress-sessions', 'true')
        const sessions = [
            makeSession({
                id: 'session-running',
                active: true,
                thinking: true,
                updatedAt: 100,
                metadata: { path: '/work/hapi', name: 'Running task', flavor: 'codex' },
            }),
            makeSession({
                id: 'session-quiet',
                active: true,
                updatedAt: 90,
                metadata: { path: '/work/hapi', name: 'Quiet task', flavor: 'codex' },
            }),
        ]
        render(renderSessionList(sessions, null))

        const activeHeader = screen.getByTitle('Active sessions')
        const activePanel = () => activeHeader.nextElementSibling
        expect(activePanel()?.getAttribute('data-open')).toBe('true')
        expect(activeHeader).not.toHaveAttribute('role', 'button')
        expect(activeHeader).not.toHaveAttribute('aria-expanded')
        expect(activeHeader.querySelector('svg')).toHaveClass('rotate-90')

        fireEvent.click(activeHeader)
        fireEvent.keyDown(activeHeader, { key: 'Enter' })
        expect(activePanel()?.getAttribute('data-open')).toBe('true')

        // Search filtering also leaves the section open.
        fireEvent.click(screen.getByRole('button', { name: SEARCH_LABEL }))
        fireEvent.change(screen.getByPlaceholderText(SEARCH_PLACEHOLDER), {
            target: { value: 'Quiet' },
        })
        expect(activePanel()?.getAttribute('data-open')).toBe('true')
    })

    it('keeps the Working section visible and non-collapsible', () => {
        localStorage.setItem('hapi-pin-in-progress-sessions', 'true')
        const sessions = [
            makeSession({
                id: 'session-running',
                active: true,
                thinking: true,
                updatedAt: 100,
                metadata: { path: '/work/hapi', name: 'Running task', flavor: 'codex' },
            }),
            makeSession({
                id: 'session-idle',
                updatedAt: 50,
                metadata: { path: '/work/hapi', name: 'Idle task', flavor: 'codex' },
            }),
        ]
        render(renderSessionList(sessions))

        const workingHeader = screen.getByTitle('Working sessions')
        const workingPanel = () => workingHeader.nextElementSibling

        expect(workingPanel()?.getAttribute('data-open')).toBe('true')
        expect(workingHeader).not.toHaveAttribute('role', 'button')
        expect(workingHeader).not.toHaveAttribute('aria-expanded')
        expect(workingHeader.querySelector('svg')).toHaveClass('rotate-90')

        fireEvent.click(workingHeader)
        fireEvent.keyDown(workingHeader, { key: 'Enter' })
        expect(workingPanel()?.getAttribute('data-open')).toBe('true')

        fireEvent.click(screen.getByRole('button', { name: SEARCH_LABEL }))
        fireEvent.change(screen.getByPlaceholderText(SEARCH_PLACEHOLDER), {
            target: { value: 'Running' },
        })

        expect(workingPanel()?.getAttribute('data-open')).toBe('true')
    })

    it('reveals recent inactive sessions newest-first in batches of five', () => {
        const sessions = Array.from({ length: 7 }, (_, index) => makeSession({
            id: `recent-${index + 1}`,
            updatedAt: index + 1,
            metadata: {
                path: `/work/project-${index + 1}`,
                name: `History ${index + 1}`,
                agentSessionId: `thread-${index + 1}`
            }
        }))

        renderWithProviders(
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

        const recentHeader = screen.getByRole('button', { name: 'Toggle recent history' })
        expect(recentHeader).toHaveAttribute('aria-expanded', 'false')
        expect(screen.getByTestId('recent-session-indicator')).toHaveClass('bg-[var(--app-badge-warning-text)]')
        fireEvent.click(recentHeader)

        const panel = recentHeader.nextElementSibling as HTMLElement
        const firstBatch = panel.querySelectorAll('button[data-session-scroll-anchor]')
        expect(firstBatch).toHaveLength(5)
        expect(firstBatch[0]).toHaveTextContent('History 7')
        expect(firstBatch[4]).toHaveTextContent('History 3')

        fireEvent.click(screen.getByRole('button', { name: 'Expand 2' }))
        expect(panel.querySelectorAll('button[data-session-scroll-anchor]')).toHaveLength(7)
    })

    it('keeps the previous selected path open when selection moves', async () => {
        const sessions = [
            makeSession({
                id: 'session-first',
                updatedAt: 100,
                metadata: { path: '/work/first', name: 'First task', flavor: 'codex' },
            }),
            makeSession({
                id: 'session-second',
                updatedAt: 90,
                metadata: { path: '/work/second', name: 'Second task', flavor: 'codex' },
            })
        ]
        const { rerender } = render(renderSessionList(sessions, 'session-first'))
        const firstPanel = screen.getByTitle('/work/first').nextElementSibling

        expect(firstPanel?.getAttribute('data-open')).toBe('true')

        rerender(renderSessionList(sessions, 'session-second'))

        await waitFor(() => {
            expect(firstPanel?.getAttribute('data-open')).toBe('true')
        })
    })

    it('keeps the configured session preview fold while searching', () => {
        localStorage.setItem('hapi-session-preview-limit', '2')
        const sessions = Array.from({ length: 4 }, (_, index) => makeSession({
            id: `matching-${index + 1}`,
            updatedAt: 100 - index,
            metadata: {
                path: '/work/hapi',
                name: `Matching task ${index + 1}`,
                flavor: 'codex',
            },
        }))

        render(renderSessionList(sessions, null))
        fireEvent.click(screen.getByRole('button', { name: SEARCH_LABEL }))
        fireEvent.change(screen.getByPlaceholderText(SEARCH_PLACEHOLDER), {
            target: { value: 'Matching task' },
        })

        expect(screen.getByRole('button', { name: /Matching task 1/ })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /Matching task 2/ })).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: /Matching task 3/ })).toBeNull()
        expect(screen.queryByRole('button', { name: /Matching task 4/ })).toBeNull()

        fireEvent.click(screen.getByRole('button', { name: 'Expand 2' }))

        expect(screen.getByRole('button', { name: /Matching task 3/ })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /Matching task 4/ })).toBeInTheDocument()
    })

    it('mounts collapsed group rows only while open or closing', () => {
        const sessions = [makeSession({
            id: 'session-closed',
            updatedAt: 100,
            metadata: { path: '/work/hapi', name: 'Closed task', flavor: 'codex' },
        })]
        render(renderSessionList(sessions, null))

        const header = screen.getByTitle('/work/hapi')
        expect(screen.queryByRole('button', { name: /Closed task/ })).toBeNull()

        fireEvent.click(header)
        const row = screen.getByRole('button', { name: /Closed task/ })

        fireEvent.click(header)
        expect(row).toBeInTheDocument()
        const panel = row.closest('.collapsible-panel')!
        fireEvent.transitionEnd(panel.querySelector('.collapsible-inner')!)
        expect(row).toBeInTheDocument()
        fireEvent.transitionEnd(panel)
        expect(screen.queryByRole('button', { name: /Closed task/ })).toBeNull()
    })

    it('keeps a collapsing row mounted while its rename dialog is open', () => {
        const sessions = [makeSession({
            id: 'session-closed',
            updatedAt: 100,
            metadata: { path: '/work/hapi', name: 'Closed task', flavor: 'codex' },
        })]
        render(renderSessionList(sessions, null))

        const header = screen.getByTitle('/work/hapi')
        fireEvent.click(header)
        const row = screen.getByRole('button', { name: /Closed task/ })
        const panel = row.closest('.collapsible-panel')!
        fireEvent.contextMenu(row)
        fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }))
        expect(screen.getByRole('dialog', { name: 'Rename Session' })).toBeInTheDocument()

        fireEvent.click(header)
        fireEvent.transitionEnd(panel)
        expect(screen.getByRole('dialog', { name: 'Rename Session' })).toBeInTheDocument()

        fireEvent.keyDown(screen.getByRole('dialog', { name: 'Rename Session' }), { key: 'Escape' })
        expect(screen.queryByRole('dialog', { name: 'Rename Session' })).toBeNull()
        expect(screen.queryByRole('button', { name: /Closed task/ })).toBeNull()
    })

    it('expands and collapses the session preview one batch at a time', () => {
        localStorage.setItem('hapi-session-preview-limit', '2')
        const sessions = Array.from({ length: 6 }, (_, index) => makeSession({
            id: `session-${index + 1}`,
            updatedAt: 100 - index,
            metadata: {
                path: '/work/hapi',
                name: `Task ${index + 1}`,
                flavor: 'codex',
            },
        }))

        render(renderSessionList(sessions, null))
        fireEvent.click(screen.getByTitle('/work/hapi'))

        expect(screen.getByRole('button', { name: 'Expand 2' })).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: 'Collapse 2' })).toBeNull()

        fireEvent.click(screen.getByRole('button', { name: 'Expand 2' }))

        expect(screen.getByRole('button', { name: /Task 4/ })).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: /Task 5/ })).toBeNull()
        expect(screen.getByRole('button', { name: 'Collapse 2' })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Expand 2' })).toBeInTheDocument()

        fireEvent.click(screen.getByRole('button', { name: 'Expand 2' }))

        expect(screen.getByRole('button', { name: /Task 6/ })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Collapse 2' })).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: 'Expand 2' })).toBeNull()

        fireEvent.click(screen.getByRole('button', { name: 'Collapse 2' }))

        expect(screen.queryByRole('button', { name: /Task 5/ })).toBeNull()
        expect(screen.getByRole('button', { name: 'Collapse 2' })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Expand 2' })).toBeInTheDocument()

        fireEvent.click(screen.getByRole('button', { name: 'Collapse 2' }))

        expect(screen.queryByRole('button', { name: /Task 3/ })).toBeNull()
        expect(screen.queryByRole('button', { name: 'Collapse 2' })).toBeNull()
        expect(screen.getByRole('button', { name: 'Expand 2' })).toBeInTheDocument()
    })

    it('does not offer a no-op collapse when required sessions exceed the preview limit', () => {
        localStorage.setItem('hapi-session-preview-limit', '2')
        localStorage.setItem('hapi-pin-in-progress-sessions', 'false')
        const sessions = Array.from({ length: 4 }, (_, index) => makeSession({
            id: `session-${index + 1}`,
            updatedAt: 100 - index,
            active: index > 0,
            pendingRequestsCount: index > 0 ? 1 : 0,
            metadata: {
                path: '/work/hapi',
                name: `Task ${index + 1}`,
                flavor: 'codex',
            },
        }))

        render(renderSessionList(sessions, null))
        fireEvent.click(screen.getByTitle('/work/hapi'))

        expect(screen.queryByRole('button', { name: /Collapse/ })).toBeNull()
        expect(screen.queryByRole('button', { name: /Task 1/ })).toBeNull()
        expect(screen.getByRole('button', { name: 'Expand 1' })).toBeInTheDocument()

        fireEvent.click(screen.getByRole('button', { name: 'Expand 1' }))

        expect(screen.getByRole('button', { name: /Task 1/ })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Collapse 1' })).toBeInTheDocument()

        fireEvent.click(screen.getByRole('button', { name: 'Collapse 1' }))

        expect(screen.queryByRole('button', { name: /Task 1/ })).toBeNull()
        expect(screen.queryByRole('button', { name: /Collapse/ })).toBeNull()
    })

    it('expands from the rendered count when required sessions exceed the preview limit', () => {
        localStorage.setItem('hapi-session-preview-limit', '2')
        localStorage.setItem('hapi-pin-in-progress-sessions', 'false')
        const sessions = Array.from({ length: 8 }, (_, index) => makeSession({
            id: `session-${index + 1}`,
            updatedAt: 100 - index,
            active: index < 5,
            pendingRequestsCount: index < 5 ? 1 : 0,
            metadata: {
                path: '/work/hapi',
                name: `Task ${index + 1}`,
                flavor: 'codex',
            },
        }))

        render(renderSessionList(sessions, null))
        fireEvent.click(screen.getByTitle('/work/hapi'))

        expect(screen.getByRole('button', { name: /Task 5/ })).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: /Task 6/ })).toBeNull()
        expect(screen.getByRole('button', { name: 'Expand 2' })).toBeInTheDocument()

        fireEvent.click(screen.getByRole('button', { name: 'Expand 2' }))

        expect(screen.getByRole('button', { name: /Task 6/ })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /Task 7/ })).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: /Task 8/ })).toBeNull()
        expect(screen.getByRole('button', { name: 'Expand 1' })).toBeInTheDocument()
    })
})

describe('SessionList search toggle', () => {
    it('expands on icon click and keeps filtering after collapsing on blur', () => {
        const sessions = [
            makeSession({
                id: 'session-match',
                updatedAt: 100,
                metadata: { path: '/work/hapi', name: 'Matching task', flavor: 'codex' },
            }),
            makeSession({
                id: 'session-other',
                updatedAt: 90,
                metadata: { path: '/work/hapi', name: 'Other task', flavor: 'codex' },
            }),
        ]

        renderWithProviders(
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

        // Collapsed by default: only the toggle icon is rendered.
        expect(screen.queryByPlaceholderText(SEARCH_PLACEHOLDER)).toBeNull()
        expect(screen.queryByRole('button', { name: 'Unread only' })).toBeNull()
        expect(screen.queryByRole('button', { name: 'Filter sessions by last activity' })).toBeNull()

        fireEvent.click(screen.getByRole('button', { name: SEARCH_LABEL }))
        const input = screen.getByPlaceholderText(SEARCH_PLACEHOLDER)
        expect(input).toHaveFocus()

        fireEvent.change(input, { target: { value: 'Matching' } })
        expect(screen.getByRole('button', { name: /Matching task/ })).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: /Other task/ })).toBeNull()

        // Blur collapses back to the icon; the query stays applied.
        fireEvent.blur(input)
        expect(screen.queryByPlaceholderText(SEARCH_PLACEHOLDER)).toBeNull()
        expect(screen.getByRole('button', { name: /Search sessions/ })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /Matching task/ })).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: /Other task/ })).toBeNull()
    })

    it('shows truncated query text on the collapsed search control when a text filter is active', () => {
        const sessions = [
            makeSession({
                id: 'session-jelly',
                updatedAt: 100,
                metadata: { path: '/work/hapi', name: 'jellybot task', flavor: 'codex' },
            }),
            makeSession({
                id: 'session-other',
                updatedAt: 90,
                metadata: { path: '/work/hapi', name: 'Other task', flavor: 'codex' },
            }),
        ]

        renderWithProviders(
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

        fireEvent.click(screen.getByRole('button', { name: SEARCH_LABEL }))
        const input = screen.getByPlaceholderText(SEARCH_PLACEHOLDER)
        fireEvent.change(input, { target: { value: 'jellybot' } })
        fireEvent.blur(input)

        expect(screen.queryByPlaceholderText(SEARCH_PLACEHOLDER)).toBeNull()
        const collapsed = screen.getByRole('button', { name: /Search sessions/ })
        expect(collapsed).toHaveTextContent('jellybot')
        expect(collapsed.className).toContain('bg-[var(--app-chat-user-chip-bg)]')
        expect(collapsed.className).toContain('text-[var(--app-chat-user-chip-fg)]')
        const clearButton = screen.getByRole('button', { name: 'Clear search' })
        expect(clearButton.className).toContain('bg-[var(--app-chat-user-chip-action-bg)]')
        expect(clearButton.className).toContain('text-[var(--app-chat-user-chip-action-fg)]')
        expect(clearButton.className).toContain('hover:text-[var(--app-chat-user-chip-action-hover-fg)]')
        expect(screen.getByRole('button', { name: /jellybot task/ })).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: /Other task/ })).toBeNull()
    })

    it('clears a collapsed text filter without expanding the search control', () => {
        const sessions = [
            makeSession({
                id: 'session-match',
                updatedAt: 100,
                metadata: { path: '/work/hapi', name: 'Matching task', flavor: 'codex' },
            }),
            makeSession({
                id: 'session-other',
                updatedAt: 90,
                metadata: { path: '/work/hapi', name: 'Other task', flavor: 'codex' },
            }),
        ]

        renderWithProviders(
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

        fireEvent.click(screen.getByRole('button', { name: SEARCH_LABEL }))
        const input = screen.getByPlaceholderText(SEARCH_PLACEHOLDER)
        fireEvent.change(input, { target: { value: 'Matching' } })
        fireEvent.blur(input)

        expect(screen.queryByPlaceholderText(SEARCH_PLACEHOLDER)).toBeNull()
        fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))

        expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull()
        expect(screen.queryByPlaceholderText(SEARCH_PLACEHOLDER)).toBeNull()
        expect(screen.getByRole('button', { name: SEARCH_LABEL })).toHaveFocus()
        expect(screen.getByRole('button', { name: /Matching task/ })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /Other task/ })).toBeInTheDocument()
    })

    it('keeps collapsed search chrome from sharing a shrink row with header actions (tiann/hapi#2039)', () => {
        renderWithProviders(
            <SessionList
                sessions={[makeSession({
                    id: 'session-1',
                    updatedAt: 100,
                    metadata: { path: '/work/hapi', name: 'Matching task', flavor: 'codex' },
                })]}
                selectedSessionId={null}
                onSelect={vi.fn()}
                onNewSession={vi.fn()}
                onRefresh={vi.fn()}
                isLoading={false}
                renderHeader={false}
                headerActions={<button type="button">Settings</button>}
                api={null}
            />
        )

        fireEvent.click(screen.getByRole('button', { name: SEARCH_LABEL }))
        const input = screen.getByPlaceholderText(SEARCH_PLACEHOLDER)
        fireEvent.change(input, { target: { value: 'Matching' } })
        fireEvent.blur(input)

        const searchGroup = screen.getByTestId('session-list-search')
        const headerRow = screen.getByTestId('session-list-header-row')
        const actions = screen.getByTestId('session-list-header-actions')
        const clearButton = screen.getByRole('button', { name: 'Clear search' })

        expect(searchGroup).toHaveAttribute('data-expanded', 'false')
        // Active query yields (min-w-0) so More stays on-screen; idle search keeps shrink-0.
        expect(searchGroup).toHaveClass('min-w-0')
        expect(searchGroup.className.split(/\s+/)).not.toContain('shrink-0')
        expect(headerRow).toContainElement(searchGroup)
        expect(headerRow).toContainElement(actions)
        expect(actions).not.toContainElement(clearButton)
        expect(searchGroup).toContainElement(clearButton)
        // Actions stay on the same row; with a query chip, primaries fold into More
        // so [chip][⋯] fits ~320px instead of pushing Settings offscreen.
        expect(searchGroup.nextElementSibling).toBe(actions)
        // Actions stay flex-1 so the budget is the row leftover, not the icon cluster.
        expect(actions).toHaveClass('flex-1', 'min-w-0', 'flex-nowrap')
        expect(actions.className.split(/\s+/)).not.toContain('shrink-0')
        expect(actions.className.split(/\s+/)).not.toContain('flex-wrap')
        expect(headerRow).toHaveClass('flex-nowrap', '@container')
        expect(headerRow.className.split(/\s+/)).not.toContain('flex-wrap')
        // Unmeasured query keeps the available header controls on the row.
        expect(within(actions).getByRole('button', { name: 'Settings' })).toBeInTheDocument()
        expect(screen.queryByTestId('session-list-header-overflow')).toBeNull()
    })

    it('reobserves the actions box after search expands and collapses (tiann/hapi#2040)', () => {
        const observed: Element[] = []
        class FakeResizeObserver {
            observe = (target: Element) => { observed.push(target) }
            unobserve = vi.fn()
            disconnect = vi.fn()
        }
        vi.stubGlobal('ResizeObserver', FakeResizeObserver)

        renderWithProviders(
            <SessionList
                sessions={[makeSession({
                    id: 'session-1',
                    updatedAt: 100,
                    metadata: { path: '/work/hapi', name: 'Matching task', flavor: 'codex' },
                })]}
                selectedSessionId={null}
                onSelect={vi.fn()}
                onNewSession={vi.fn()}
                onRefresh={vi.fn()}
                isLoading={false}
                renderHeader={false}
                api={null}
            />
        )

        const first = screen.getByTestId('session-list-header-actions')
        expect(observed).toContain(first)
        fireEvent.click(screen.getByRole('button', { name: SEARCH_LABEL }))
        expect(screen.queryByTestId('session-list-header-actions')).toBeNull()
        fireEvent.blur(screen.getByPlaceholderText(SEARCH_PLACEHOLDER))
        const second = screen.getByTestId('session-list-header-actions')
        expect(second).not.toBe(first)
        expect(observed).toContain(second)
        vi.unstubAllGlobals()
    })

    function stubHeaderWidth(width: number | { row: number; actions: number }) {
        const widths = typeof width === 'number'
            ? { row: width, actions: width }
            : width
        class FakeResizeObserver {
            callback: ResizeObserverCallback
            constructor(cb: ResizeObserverCallback) {
                this.callback = cb
            }
            observe = (target: Element) => {
                const isRow = (target as HTMLElement).dataset?.testid === 'session-list-header-row'
                const reported = isRow ? widths.row : widths.actions
                this.callback(
                    [{ target, contentRect: { width: reported } as DOMRectReadOnly } as ResizeObserverEntry],
                    this as unknown as ResizeObserver
                )
            }
            unobserve = vi.fn()
            disconnect = vi.fn()
        }
        vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    }

    it('folds primary actions into More on a narrow empty-query header (tiann/hapi#2040)', () => {
        localStorage.setItem('hapi-font-scale', '1.3')
        stubHeaderWidth(320)

        const now = Date.now()
        renderWithProviders(
            <SessionList
                sessions={[
                    makeSession({
                        id: 'session-a',
                        updatedAt: now,
                        metadata: {
                            path: '/work/hapi',
                            name: 'Machine A task',
                            flavor: 'codex',
                            machineId: 'machine-a',
                        },
                    }),
                    makeSession({
                        id: 'session-b',
                        updatedAt: now - 1000,
                        metadata: {
                            path: '/work/other',
                            name: 'Machine B task',
                            flavor: 'codex',
                            machineId: 'machine-b',
                        },
                    }),
                ]}
                selectedSessionId={null}
                onSelect={vi.fn()}
                onNewSession={vi.fn()}
                onRefresh={vi.fn()}
                isLoading={false}
                renderHeader
                headerActions={<button type="button">Settings</button>}
                api={null}
                machineLabelsById={{ 'machine-a': 'Mint', 'machine-b': 'Teemo' }}
            />
        )

        // Empty query + 320px still fits the daily controls. Do not collapse
        // the row to [search][⋯]. Machine menu stays in the row (not shed).
        const actions = screen.getByTestId('session-list-header-actions')
        expect(within(actions).getByRole('button', { name: 'New Session' })).toBeInTheDocument()
        expect(within(actions).getByRole('button', { name: 'Settings' })).toBeInTheDocument()
        expect(within(actions).getByRole('button', { name: 'Filter sessions by machine' })).toBeInTheDocument()
        expect(screen.queryByTestId('session-list-header-overflow')).toBeNull()

        vi.unstubAllGlobals()
        localStorage.removeItem('hapi-font-scale')
    })

    it('lets a long query chip yield so More stays on-screen at 320px / 130% (tiann/hapi#2040)', () => {
        localStorage.setItem('hapi-font-scale', '1.3')
        // Phone row 320px; actions leftover crushed to ~80px (the bug geometry).
        // Search must cap itself so machine menu + More still fit in that row.
        stubHeaderWidth({ row: 320, actions: 80 })
        const machineMenuPx = 47
        const morePx = 47
        const originalOffset = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth')
        Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
            configurable: true,
            get() {
                if ((this as HTMLElement).dataset?.testid === 'session-list-header-machine-menu') {
                    return machineMenuPx
                }
                if ((this as HTMLElement).dataset?.measureId === '__more') {
                    return morePx
                }
                return originalOffset?.get?.call(this) ?? 0
            },
        })

        const now = Date.now()
        renderWithProviders(
            <SessionList
                sessions={[
                    makeSession({
                        id: 'session-a',
                        updatedAt: now,
                        metadata: {
                            path: '/work/hapi',
                            name: 'Machine A task',
                            flavor: 'codex',
                            machineId: 'machine-a',
                        },
                    }),
                    makeSession({
                        id: 'session-b',
                        updatedAt: now - 1000,
                        metadata: {
                            path: '/work/other',
                            name: 'Machine B task',
                            flavor: 'codex',
                            machineId: 'machine-b',
                        },
                    }),
                ]}
                selectedSessionId={null}
                onSelect={vi.fn()}
                onNewSession={vi.fn()}
                onRefresh={vi.fn()}
                isLoading={false}
                renderHeader
                headerActions={<button type="button">Settings</button>}
                api={null}
                machineLabelsById={{ 'machine-a': 'Mint', 'machine-b': 'Teemo' }}
            />
        )

        fireEvent.click(screen.getByRole('button', { name: SEARCH_LABEL }))
        const input = screen.getByPlaceholderText(SEARCH_PLACEHOLDER)
        fireEvent.change(input, {
            target: { value: 'a very long session search query that fills the chip' },
        })
        fireEvent.blur(input)

        const searchGroup = screen.getByTestId('session-list-search')
        const actions = screen.getByTestId('session-list-header-actions')
        // Chip text may shrink; More (+ machine menu) must not be crushed offscreen.
        expect(searchGroup).toHaveClass('min-w-0')
        expect(actions).toHaveClass('flex-1', 'min-w-0')
        // row 320 - pad 16 - gap - machine - gap - More ≈ 201 at 130% metrics.
        const maxWidth = Number.parseFloat(searchGroup.style.maxWidth)
        expect(maxWidth).toBeGreaterThan(0)
        expect(maxWidth).toBeLessThanOrEqual(320 - machineMenuPx - morePx)
        expect(screen.getByTestId('session-list-header-overflow')).toBeInTheDocument()
        expect(within(actions).getByRole('button', { name: /more/i })).toBeInTheDocument()
        expect(within(actions).getByTestId('session-list-header-machine-menu')).toBeInTheDocument()

        if (originalOffset) {
            Object.defineProperty(HTMLElement.prototype, 'offsetWidth', originalOffset)
        }
        vi.unstubAllGlobals()
        localStorage.removeItem('hapi-font-scale')
    })

    it('keeps primary actions inline on a Quest-width empty-query header (tiann/hapi#2040)', () => {
        // ~400px empty query must NOT collapse to [search][⋯] — that was the
        // 32rem-for-everything regression on Quest dogfood.
        stubHeaderWidth(400)

        renderWithProviders(
            <SessionList
                sessions={[makeSession({
                    id: 'session-1',
                    updatedAt: Date.now(),
                    metadata: { path: '/work/hapi', name: 'Quest width', flavor: 'codex' },
                })]}
                selectedSessionId={null}
                onSelect={vi.fn()}
                onNewSession={vi.fn()}
                onRefresh={vi.fn()}
                isLoading={false}
                renderHeader
                headerActions={<button type="button">Settings</button>}
                api={null}
            />
        )

        const actions = screen.getByTestId('session-list-header-actions')
        expect(actions).toHaveClass('flex-1')
        expect(within(actions).getByRole('button', { name: 'New Session' })).toBeInTheDocument()
        expect(within(actions).getByRole('button', { name: 'Settings' })).toBeInTheDocument()
        // Nothing shed — no More, and no ml-auto hole between + and ⋯.
        expect(screen.queryByTestId('session-list-header-overflow')).toBeNull()

        vi.unstubAllGlobals()
    })

    it('keeps primary actions inline with a query chip when the header is wide (tiann/hapi#2040)', () => {
        const observe = vi.fn()
        const disconnect = vi.fn()
        class FakeResizeObserver {
            callback: ResizeObserverCallback
            constructor(cb: ResizeObserverCallback) {
                this.callback = cb
            }
            observe = (target: Element) => {
                observe(target)
                this.callback(
                    [{ target, contentRect: { width: 640 } as DOMRectReadOnly } as ResizeObserverEntry],
                    this as unknown as ResizeObserver
                )
            }
            unobserve = vi.fn()
            disconnect = disconnect
        }
        vi.stubGlobal('ResizeObserver', FakeResizeObserver)

        renderWithProviders(
            <SessionList
                sessions={[makeSession({
                    id: 'session-1',
                    updatedAt: 100,
                    metadata: { path: '/work/hapi', name: 'Wide header', flavor: 'codex' },
                })]}
                selectedSessionId={null}
                onSelect={vi.fn()}
                onNewSession={vi.fn()}
                onRefresh={vi.fn()}
                isLoading={false}
                renderHeader
                headerActions={<button type="button">Settings</button>}
                api={null}
            />
        )

        fireEvent.click(screen.getByRole('button', { name: SEARCH_LABEL }))
        const input = screen.getByPlaceholderText(SEARCH_PLACEHOLDER)
        fireEvent.change(input, { target: { value: 'Wide' } })
        fireEvent.blur(input)

        // Wide header + query: New stays inline (not folded into More-only).
        expect(screen.getByRole('button', { name: 'New Session' })).toBeInTheDocument()

        vi.unstubAllGlobals()
    })

    it('keeps secondary headerActions inline via container query when search is idle (tiann/hapi#2039)', () => {
        renderWithProviders(
            <SessionList
                sessions={[makeSession({
                    id: 'session-1',
                    updatedAt: 100,
                    metadata: { path: '/work/hapi', name: 'Idle search', flavor: 'codex' },
                })]}
                selectedSessionId={null}
                onSelect={vi.fn()}
                onNewSession={vi.fn()}
                onRefresh={vi.fn()}
                isLoading={false}
                renderHeader={false}
                headerActions={<button type="button">Settings</button>}
                api={null}
            />
        )

        expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument()
        expect(screen.queryByTestId('session-list-header-overflow')).toBeNull()
    })

    it('gives expanded search a 48px clear end-cap with calendar immediately left (tiann/hapi#2019)', () => {
        renderWithProviders(
            <SessionList
                sessions={[makeSession({
                    id: 'session-1',
                    updatedAt: 100,
                    metadata: { path: '/work/hapi', name: 'Task', flavor: 'codex' },
                })]}
                selectedSessionId={null}
                onSelect={vi.fn()}
                onNewSession={vi.fn()}
                onRefresh={vi.fn()}
                isLoading={false}
                renderHeader={false}
                api={null}
            />
        )

        fireEvent.click(screen.getByRole('button', { name: SEARCH_LABEL }))
        const input = screen.getByPlaceholderText(SEARCH_PLACEHOLDER)
        fireEvent.change(input, { target: { value: 'DJ' } })

        const clearButton = screen.getByRole('button', { name: 'Clear search' })
        expect(clearButton.className).toMatch(/session-list-search-clear-endcap/)
        expect(clearButton.className).toMatch(/min-h-\[48px\]/)
        expect(clearButton.className).toMatch(/min-w-\[48px\]/)

        const dateButton = screen.getByTestId('session-list-search-date-embedded')
        expect(dateButton.className).toMatch(/min-h-\[48px\]/)
        expect(dateButton.className).toMatch(/min-w-\[48px\]/)
        expect(clearButton.parentElement?.contains(dateButton)).toBe(true)

        const fieldChildren = Array.from(clearButton.parentElement?.children ?? [])
        const dateIndex = fieldChildren.findIndex((node) => node === dateButton.parentElement || node.contains(dateButton))
        const clearIndex = fieldChildren.indexOf(clearButton)
        expect(dateIndex).toBeGreaterThanOrEqual(0)
        expect(clearIndex).toBeGreaterThan(dateIndex)
    })

    it('stays expanded with focus on the input after clearing the query', () => {
        renderWithProviders(
            <SessionList
                sessions={[makeSession({
                    id: 'session-1',
                    updatedAt: 100,
                    metadata: { path: '/work/hapi', name: 'Task', flavor: 'codex' },
                })]}
                selectedSessionId={null}
                onSelect={vi.fn()}
                onNewSession={vi.fn()}
                onRefresh={vi.fn()}
                isLoading={false}
                renderHeader={false}
                api={null}
            />
        )

        fireEvent.click(screen.getByRole('button', { name: SEARCH_LABEL }))
        const input = screen.getByPlaceholderText(SEARCH_PLACEHOLDER)
        fireEvent.change(input, { target: { value: 'Task' } })

        // The clear button unmounts itself; focus must return to the input so a
        // later outside click still collapses the search via the wrapper blur.
        fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))

        expect(input).toHaveFocus()
        expect(input).toHaveValue('')
        expect(screen.getByPlaceholderText(SEARCH_PLACEHOLDER)).toBeInTheDocument()
    })

    it('keeps header actions visible when sessions become empty while search is expanded', () => {
        const renderList = (sessions: SessionSummary[]) => (
            <QueryClientProvider client={new QueryClient({
                defaultOptions: {
                    queries: { retry: false },
                    mutations: { retry: false },
                }
            })}>
                <ToastProvider>
                    <I18nProvider>
                        <AppContextTestProvider>
                            <SessionList
                                sessions={sessions}
                                selectedSessionId={null}
                                onSelect={vi.fn()}
                                onNewSession={vi.fn()}
                                onRefresh={vi.fn()}
                                isLoading={false}
                                renderHeader={false}
                                headerActions={<button type="button">Refresh</button>}
                                api={null}
                            />
                        </AppContextTestProvider>
                    </I18nProvider>
                </ToastProvider>
            </QueryClientProvider>
        )
        const { rerender } = render(renderList([
            makeSession({
                id: 'session-1',
                updatedAt: 100,
                metadata: { path: '/work/hapi', name: 'Task', flavor: 'codex' },
            }),
        ]))

        fireEvent.click(screen.getByRole('button', { name: SEARCH_LABEL }))
        expect(screen.queryByRole('button', { name: 'Refresh' })).toBeNull()

        rerender(renderList([]))

        expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: SEARCH_LABEL })).toBeNull()
    })
})
