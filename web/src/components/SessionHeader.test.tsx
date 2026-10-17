import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '@/types/api'
import type { ApiClient } from '@/api/client'
import { I18nProvider } from '@/lib/i18n-context'
import { AppContextTestProvider } from '@/test/app-context'
import { ToastProvider, useToast } from '@/lib/toast-context'
import { resolveSessionHeaderMachineLabel, SessionHeader } from './SessionHeader'

afterEach(() => {
    cleanup()
    localStorage.clear()
})

function ToastMessages() {
    const { toasts } = useToast()
    return <>{toasts.map((toast) => <div key={toast.id}>{toast.title}: {toast.body}</div>)}</>
}

function baseSession(overrides: Partial<Session> = {}): Session {
    return {
        id: 'session-1',
        namespace: 'default',
        seq: 0,
        createdAt: 0,
        updatedAt: 0,
        active: true,
        activeAt: 0,
        metadata: { flavor: 'codex', path: '/repo', host: 'machine' },
        metadataVersion: 0,
        agentState: null,
        agentStateVersion: 0,
        thinking: false,
        thinkingAt: 0,
        model: null,
        modelReasoningEffort: null,
        effort: null,
        serviceTier: null,
        ...overrides
    }
}

function renderHeader(session: Session, extra?: { serviceTier?: string | null; titleSuggestionAvailable?: boolean }) {
    return render(
        <QueryClientProvider client={new QueryClient()}>
            <ToastProvider>
                <I18nProvider>
                    <AppContextTestProvider>
                        <SessionHeader
                            session={session}
                            serviceTier={extra?.serviceTier}
                            titleSuggestionAvailable={extra?.titleSuggestionAvailable}
                            onBack={vi.fn()}
                            api={null}
                        />
                    </AppContextTestProvider>
                </I18nProvider>
            </ToastProvider>
        </QueryClientProvider>
    )
}

function renderHeaderWithApi(session: Session, api: ApiClient, client = new QueryClient()) {
    return render(
        <QueryClientProvider client={client}>
            <ToastProvider>
                <I18nProvider>
                    <AppContextTestProvider>
                        <SessionHeader session={session} onBack={vi.fn()} api={api} />
                    </AppContextTestProvider>
                </I18nProvider>
            </ToastProvider>
        </QueryClientProvider>
    )
}

describe('resolveSessionHeaderMachineLabel', () => {
    it('prefers cached/display labels, then host, then short machine id', () => {
        expect(resolveSessionHeaderMachineLabel(
            baseSession({ metadata: { flavor: 'cursor', path: '/r', host: 'host.local', machineId: 'abc123456789' } }),
            { abc123456789: 'Workstation' }
        )).toBe('Workstation')

        expect(resolveSessionHeaderMachineLabel(
            baseSession({ metadata: { flavor: 'cursor', path: '/r', host: 'host.local', machineId: 'abc123456789' } }),
            {}
        )).toBe('host.local')

        expect(resolveSessionHeaderMachineLabel(
            baseSession({ metadata: { flavor: 'cursor', path: '/r', host: '', machineId: 'abc123456789' } }),
            {}
        )).toBe('abc12345')

        expect(resolveSessionHeaderMachineLabel(
            baseSession({ metadata: { flavor: 'cursor', path: '/r', host: '' } }),
            {}
        )).toBeNull()
    })
})

describe('SessionHeader', () => {
    it('opens the exact worktree folder in Code with readable slashes from the header and menu', () => {
        renderHeader(baseSession({ metadata: { path: '/repo worktrees/feature #1', host: 'machine' } }))
        const href = 'https://code.local/?folder=/repo%20worktrees/feature%20%231'
        const link = screen.getByRole('link', { name: 'Open in Code' })
        expect(link).toHaveAttribute('href', href)
        expect(link).toHaveAttribute('target', '_blank')
        expect(link).toHaveAttribute('rel', 'noopener noreferrer')
        expect(link).toHaveClass('max-sm:hidden')
        fireEvent.click(screen.getByRole('button', { name: /More/ }))
        expect(screen.getByRole('menuitem', { name: 'Open in Code' })).toHaveAttribute('href', href)
    })

    it('updates the discovered MR with Git data and does not reuse an attached review from another branch', async () => {
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
        const getGitStatus = vi.fn().mockResolvedValue({
            success: true, stdout: '# branch.head first',
            mergeRequestUrl: 'https://gitlab.example.test/group/project/-/merge_requests/7',
        })
        const api = {
            getGitStatus,
            getMachines: vi.fn().mockResolvedValue({ machines: [] }),
            getScratchlist: vi.fn().mockResolvedValue({ entries: [] }),
        } as unknown as ApiClient
        renderHeaderWithApi(baseSession({ metadata: {
            path: '/repo', host: 'machine',
        } }), api, client)
        expect(await screen.findByRole('link', { name: 'Open PR' })).toHaveAttribute(
            'href', 'https://gitlab.example.test/group/project/-/merge_requests/7'
        )
        fireEvent.click(screen.getByRole('button', { name: /More/ }))
        expect(screen.getByRole('menuitem', { name: 'Open PR' })).toHaveAttribute(
            'href', 'https://gitlab.example.test/group/project/-/merge_requests/7'
        )

        getGitStatus.mockResolvedValue({
            success: true, stdout: '# branch.head second', mergeRequestUrl: null,
            createMergeRequestUrl: 'https://gitlab.example.test/group/project/-/merge_requests/new',
        })
        await act(async () => { await client.invalidateQueries() })
        await waitFor(() => expect(screen.queryByRole('link', { name: 'Open PR' })).not.toBeInTheDocument())
        expect(screen.queryByRole('menuitem', { name: 'Open PR' })).not.toBeInTheDocument()
        expect(screen.getByRole('menuitem', { name: 'Create PR' })).toHaveAttribute(
            'href', 'https://gitlab.example.test/group/project/-/merge_requests/new'
        )
    })

    it('links directly to GitLab merge request creation without messaging the agent', async () => {
        const sendMessage = vi.fn()
        const createMergeRequestUrl = 'https://gitlab.example.test/group/project/-/merge_requests/new?merge_request%5Bsource_branch%5D=feature%2Freview'
        const api = {
            getGitStatus: vi.fn().mockResolvedValue({
                success: true,
                stdout: '# branch.oid abcdef123456\n# branch.head feature/review\n',
                createMergeRequestUrl,
            }),
            getMachines: vi.fn().mockResolvedValue({ machines: [] }),
            getScratchlist: vi.fn().mockResolvedValue({ entries: [] }),
            sendMessage,
        } as unknown as ApiClient

        render(
            <AppContextTestProvider>
            <QueryClientProvider client={new QueryClient()}>
                <ToastProvider>
                    <I18nProvider>
                        <SessionHeader session={baseSession()} onBack={vi.fn()} api={api} />
                        <ToastMessages />
                    </I18nProvider>
                </ToastProvider>
            </QueryClientProvider>
            </AppContextTestProvider>
        )

        fireEvent.click(screen.getByRole('button', { name: /More/ }))
        const link = await screen.findByRole('menuitem', { name: 'Create PR' })
        expect(link).toHaveAttribute('href', createMergeRequestUrl)
        expect(link).toHaveAttribute('target', '_blank')
        expect(sendMessage).not.toHaveBeenCalled()
    })

    it('queues Codex title regeneration from the session menu', async () => {
        const regenerateSessionTitle = vi.fn().mockResolvedValue(undefined)
        const api = {
            getMachines: vi.fn().mockResolvedValue({ machines: [] }),
            getScratchlist: vi.fn().mockResolvedValue({ entries: [] }),
            regenerateSessionTitle
        } as unknown as ApiClient

        render(
            <AppContextTestProvider>
            <QueryClientProvider client={new QueryClient()}>
                <ToastProvider>
                    <I18nProvider>
                        <SessionHeader
                            session={baseSession()}
                            onBack={vi.fn()}
                            api={api}
                        />
                        <ToastMessages />
                    </I18nProvider>
                </ToastProvider>
            </QueryClientProvider>
            </AppContextTestProvider>
        )

        fireEvent.click(screen.getByRole('button', { name: /More/ }))
        fireEvent.click(screen.getByRole('menuitem', { name: 'Regenerate title' }))

        await waitFor(() => expect(regenerateSessionTitle).toHaveBeenCalledWith('session-1'))
        expect(await screen.findByText(/Title regeneration queued/)).toBeInTheDocument()
    })

    it('does not offer manual Codex sync while the HAPI session is active', () => {
        const api = {
            getMachines: vi.fn().mockResolvedValue({ machines: [] }),
            getScratchlist: vi.fn().mockResolvedValue({ entries: [] }),
            syncCodexSession: vi.fn()
        } as unknown as ApiClient

        renderHeaderWithApi(baseSession({
            active: true,
            metadata: { flavor: 'codex', path: '/repo', host: 'machine', codexSessionId: 'codex-thread-1' }
        }), api)

        fireEvent.click(screen.getByRole('button', { name: /More/ }))
        expect(screen.queryByRole('menuitem', { name: /Sync Codex/ })).toBeNull()
    })

    it('keeps manual Codex sync available for an inactive imported thread', () => {
        const api = {
            getMachines: vi.fn().mockResolvedValue({ machines: [] }),
            getScratchlist: vi.fn().mockResolvedValue({ entries: [] }),
            syncCodexSession: vi.fn()
        } as unknown as ApiClient

        renderHeaderWithApi(baseSession({
            active: false,
            metadata: { flavor: 'codex', path: '/repo', host: 'machine', codexSessionId: 'codex-thread-1' }
        }), api)

        fireEvent.click(screen.getByRole('button', { name: /More/ }))
        expect(screen.getByRole('menuitem', { name: /Sync Codex/ })).toBeInTheDocument()
    })

    it('hides title generation when the Hub does not advertise the capability', () => {
        const api = {
            getMachines: vi.fn().mockResolvedValue({ machines: [] }),
            getScratchlist: vi.fn().mockResolvedValue({ entries: [] })
        } as unknown as ApiClient

        render(
            <AppContextTestProvider>
            <QueryClientProvider client={new QueryClient()}>
                <ToastProvider>
                    <I18nProvider>
                        <SessionHeader
                            session={baseSession()}
                            onBack={vi.fn()}
                            api={api}
                            titleSuggestionAvailable={false}
                        />
                    </I18nProvider>
                </ToastProvider>
            </QueryClientProvider>
            </AppContextTestProvider>
        )

        fireEvent.click(screen.getByTitle('More actions'))
        fireEvent.click(screen.getByRole('menuitem', { name: /Rename/ }))

        expect(screen.queryByRole('button', { name: 'Generate' })).not.toBeInTheDocument()
    })

    it('manually syncs an inactive Pi session through its owning machine', async () => {
        const importPiSessions = vi.fn().mockResolvedValue({
            success: true,
            results: [{ piSessionId: 'pi-native-1', hapiSessionId: 'session-1', action: 'updated', appended: 2 }]
        })
        const api = {
            getMachines: vi.fn().mockResolvedValue({ machines: [] }),
            importPiSessions
        } as unknown as import('@/api/client').ApiClient
        const queryClient = new QueryClient()
        const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined)
        render(
            <AppContextTestProvider>
            <QueryClientProvider client={queryClient}>
                <ToastProvider>
                    <I18nProvider>
                        <SessionHeader
                            session={baseSession({
                                active: false,
                                metadata: {
                                    flavor: 'pi',
                                    path: '/repo',
                                    host: 'machine',
                                    machineId: 'machine-1',
                                    piSessionId: 'pi-native-1'
                                }
                            })}
                            onBack={vi.fn()}
                            api={api}
                        />
                    </I18nProvider>
                </ToastProvider>
            </QueryClientProvider>
            </AppContextTestProvider>
        )

        fireEvent.click(screen.getByRole('button', { name: /More/ }))
        fireEvent.click(screen.getByRole('menuitem', { name: /Sync Pi history/ }))

        await waitFor(() => expect(importPiSessions).toHaveBeenCalledWith({
            sessionIds: ['pi-native-1'],
            cwd: '/repo',
            machineId: 'machine-1'
        }))
        expect(invalidateQueries).toHaveBeenCalledTimes(3)
    })

    it('does not offer manual Pi sync while the HAPI session is active', () => {
        const api = {
            getMachines: vi.fn().mockResolvedValue({ machines: [] }),
            importPiSessions: vi.fn()
        } as unknown as import('@/api/client').ApiClient
        render(
            <AppContextTestProvider>
            <QueryClientProvider client={new QueryClient()}>
                <ToastProvider>
                    <I18nProvider>
                        <SessionHeader
                            session={baseSession({
                                active: true,
                                metadata: { flavor: 'pi', path: '/repo', host: 'machine', machineId: 'machine-1', piSessionId: 'pi-native-1' }
                            })}
                            onBack={vi.fn()}
                            api={api}
                        />
                    </I18nProvider>
                </ToastProvider>
            </QueryClientProvider>
            </AppContextTestProvider>
        )

        fireEvent.click(screen.getByRole('button', { name: /More/ }))
        expect(screen.queryByRole('menuitem', { name: /Sync Pi history/ })).toBeNull()
    })

    it('renders and toggles the agent terminal control', () => {
        const onToggleTerminal = vi.fn()
        render(
            <AppContextTestProvider>
            <QueryClientProvider client={new QueryClient()}>
                <ToastProvider>
                    <I18nProvider>
                        <SessionHeader
                            session={baseSession({ metadata: { flavor: 'agy', path: '/repo', host: 'machine' } })}
                            onBack={vi.fn()}
                            onToggleTerminal={onToggleTerminal}
                            terminalActive
                            api={null}
                        />
                    </I18nProvider>
                </ToastProvider>
            </QueryClientProvider>
            </AppContextTestProvider>
        )

        const terminal = screen.getByRole('button', { name: 'Terminal' })
        expect(terminal).toHaveAttribute('aria-pressed', 'true')
        terminal.click()
        expect(onToggleTerminal).toHaveBeenCalledOnce()
    })

    it('shows an inherited catalog-default Fast tier', () => {
        renderHeader(baseSession(), { serviceTier: 'priority' })
        expect(screen.getByTestId('session-header-fast')).toHaveTextContent('fast')
        expect(screen.queryByText('reasoning default')).not.toBeInTheDocument()
    })

    it('shows Pi ordinary effort as reasoning metadata', () => {
        renderHeader(baseSession({
            metadata: { flavor: 'pi', path: '/repo', host: 'machine' },
            modelReasoningEffort: null,
            effort: 'max'
        }))

        expect(screen.getByTestId('session-header-reasoning')).toHaveTextContent('reasoning max')
    })

    it('keeps model reasoning effort for Codex and hides ordinary effort for non-Pi flavors', () => {
        const { rerender } = renderHeader(baseSession({
            modelReasoningEffort: 'xhigh',
            effort: 'max'
        }))

        expect(screen.getByTestId('session-header-reasoning')).toHaveTextContent('reasoning xhigh')

        rerender(
            <AppContextTestProvider>
            <QueryClientProvider client={new QueryClient()}>
                <ToastProvider>
                    <I18nProvider>
                        <SessionHeader
                            session={baseSession({
                                metadata: { flavor: 'claude', path: '/repo', host: 'machine' },
                                modelReasoningEffort: null,
                                effort: 'max'
                            })}
                            onBack={vi.fn()}
                            api={null}
                        />
                    </I18nProvider>
                </ToastProvider>
            </QueryClientProvider>
            </AppContextTestProvider>
        )

        expect(screen.queryByTestId('session-header-reasoning')).not.toBeInTheDocument()
    })

    it('hides Pi reasoning metadata when the header reasoning setting is disabled', () => {
        localStorage.setItem('hapi-session-header-metadata', JSON.stringify({ reasoning: false }))
        renderHeader(baseSession({
            metadata: { flavor: 'pi', path: '/repo', host: 'machine' },
            effort: 'max'
        }))

        expect(screen.queryByTestId('session-header-reasoning')).not.toBeInTheDocument()
    })

    it('shows an opted-in machine label and no relative age in the meta row', () => {
        localStorage.setItem('hapi-session-header-metadata', JSON.stringify({ branch: false, machine: true }))
        const fiveMinutesAgo = Date.now() - 5 * 60_000
        renderHeader(baseSession({
            activeAt: fiveMinutesAgo,
            updatedAt: fiveMinutesAgo,
            metadata: {
                flavor: 'cursor',
                path: '/home/heavygee/coding/hapi',
                host: 'oos-linux',
                machineId: 'machine-deadbeef'
            }
        }))

        expect(screen.getByTestId('session-header-machine')).toHaveTextContent(/oos-linux/)
        expect(screen.queryByTestId('session-header-age')).not.toBeInTheDocument()
    })

    it('shows the model as an icon, a pretty name, and capitalized effort', () => {
        renderHeader(baseSession({
            model: 'gpt-6.1-sol',
            modelReasoningEffort: 'high',
            serviceTier: 'fast',
        }), { serviceTier: 'fast' })

        const chip = screen.getByTestId('session-header-model')
        expect(chip).toHaveTextContent('GPT-6.1 Sol (High, fast)')
        expect(chip.querySelector('svg, img')).not.toBeNull()
        expect(chip.textContent).not.toMatch(/model:/)
        expect(chip.parentElement?.textContent).not.toMatch(/\bcodex\b/)
        const project = screen.getByTestId('session-header-project')
        expect(project).toHaveTextContent('repo')
        expect(project.compareDocumentPosition(chip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
        expect(screen.queryByTestId('session-header-reasoning')).not.toBeInTheDocument()
        expect(screen.queryByTestId('session-header-age')).not.toBeInTheDocument()
    })

    it('shows the live Git branch instead of the machine by default', async () => {
        const api = {
            getGitStatus: vi.fn().mockResolvedValue({
                success: true,
                stdout: '# branch.oid abcdef123456\n# branch.head feature/live-branch\n'
            }),
            getMachines: vi.fn().mockResolvedValue({ machines: [] }),
            getScratchlist: vi.fn().mockResolvedValue({ entries: [] })
        } as unknown as ApiClient

        render(
            <AppContextTestProvider>
            <QueryClientProvider client={new QueryClient()}>
                <ToastProvider>
                    <I18nProvider>
                        <SessionHeader session={baseSession()} onBack={vi.fn()} api={api} />
                    </I18nProvider>
                </ToastProvider>
            </QueryClientProvider>
            </AppContextTestProvider>
        )

        const branch = await screen.findByTestId('session-header-branch')
        expect(branch).toHaveTextContent('feature/live-branch')
        expect(branch).not.toHaveTextContent('branch:')
        expect(branch.querySelector('svg')).not.toBeNull()
        const project = screen.getByTestId('session-header-project')
        expect(project.compareDocumentPosition(branch) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
        expect(screen.queryByTestId('session-header-machine')).not.toBeInTheDocument()
    })

    it('opens full session details from the compact mobile header', async () => {
        const branch = 'feature/long-mobile-branch-name'
        const title = 'A long session title that does not fit in the mobile header'
        const api = {
            getGitStatus: vi.fn().mockResolvedValue({
                success: true,
                stdout: `# branch.oid abcdef123456\n# branch.head ${branch}\n`
            }),
            getMachines: vi.fn().mockResolvedValue({ machines: [] }),
            getScratchlist: vi.fn().mockResolvedValue({ entries: [] })
        } as unknown as ApiClient

        renderHeaderWithApi(baseSession({
            model: 'gpt-6-astra',
            metadata: { flavor: 'codex', path: '/repo', host: 'machine', name: title }
        }), api)

        const detailsButton = screen.getByTestId('session-header-mobile-details')
        const model = screen.getByTestId('session-header-mobile-model')
        const summaryButton = screen.getByTestId('session-header-mobile-summary')
        expect(detailsButton).toHaveTextContent(title)
        expect(model).toHaveTextContent('GPT-6 Astra')
        expect(model.parentElement?.textContent).not.toContain('codex')
        fireEvent.click(summaryButton)
        const dialog = screen.getByRole('dialog')
        expect(dialog).toHaveTextContent(title)
        expect(dialog).toHaveTextContent('GPT-6 Astra')
        await waitFor(() => expect(dialog).toHaveTextContent(branch))
    })

    it('anchors the action menu to the center of the More actions trigger', () => {
        renderHeader(baseSession())

        const moreButton = screen.getByTitle('More actions')
        const getBoundingClientRect = vi.spyOn(moreButton, 'getBoundingClientRect').mockReturnValue({
            bottom: 64,
            height: 32,
            left: 100,
            right: 132,
            top: 32,
            width: 32,
            x: 100,
            y: 32,
            toJSON: () => ({})
        } as DOMRect)

        try {
            fireEvent.click(moreButton)

            expect(screen.getByRole('menu').parentElement).toHaveStyle({ left: '116px' })
        } finally {
            getBoundingClientRect.mockRestore()
        }
    })

    it('toggles pin state from the header action menu', async () => {
        const setSessionPinMode = vi.fn().mockResolvedValue(undefined)
        const api = {
            getScratchlist: vi.fn().mockResolvedValue({ entries: [] }),
            setSessionPinMode
        } as unknown as ApiClient
        const session: Session = {
            id: 'session-pin',
            namespace: 'default',
            seq: 0,
            createdAt: 0,
            updatedAt: 0,
            active: false,
            activeAt: 0,
            metadata: { flavor: 'codex', path: '/repo', host: 'machine' },
            metadataVersion: 0,
            agentState: null,
            agentStateVersion: 0,
            thinking: false,
            thinkingAt: 0,
            model: null,
            modelReasoningEffort: null,
            effort: null,
            serviceTier: null,
            pinned: false,
            globalPinned: false
        }

        render(
            <AppContextTestProvider>
            <QueryClientProvider client={new QueryClient()}>
                <ToastProvider>
                    <I18nProvider>
                        <SessionHeader session={session} onBack={vi.fn()} api={api} />
                    </I18nProvider>
                </ToastProvider>
            </QueryClientProvider>
            </AppContextTestProvider>
        )

        fireEvent.click(screen.getByTitle('More actions'))
        fireEvent.click(screen.getByRole('menuitem', { name: 'Pin globally' }))

        await waitFor(() => expect(setSessionPinMode).toHaveBeenCalledWith('session-pin', 'global'))
    })

    it('shows an error toast when toggling the pin fails', async () => {
        const api = {
            getScratchlist: vi.fn().mockResolvedValue({ entries: [] }),
            setSessionPinMode: vi.fn().mockRejectedValue(new Error('Network unavailable'))
        } as unknown as ApiClient

        render(
            <AppContextTestProvider>
            <QueryClientProvider client={new QueryClient()}>
                <ToastProvider>
                    <I18nProvider>
                        <SessionHeader session={baseSession({ active: false, pinned: false })} onBack={vi.fn()} api={api} />
                        <ToastMessages />
                    </I18nProvider>
                </ToastProvider>
            </QueryClientProvider>
            </AppContextTestProvider>
        )

        fireEvent.click(screen.getByTitle('More actions'))
        fireEvent.click(screen.getByRole('menuitem', { name: 'Pin in project' }))

        expect(await screen.findByText('Could not update pin: Network unavailable')).toBeInTheDocument()
    })
})
