import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import type { ApiClient } from '@/api/client'
import type { MessageSearchResponse } from '@/types/api'
import { I18nProvider } from '@/lib/i18n-context'
import { AppContextTestProvider } from '@/test/app-context'
import { ToastProvider } from '@/lib/toast-context'
import { SessionList } from './SessionList'

const SEARCH_LABEL = 'Search sessions (title, path, Agent, machine name, ID, and more)'
const SEARCH_PLACEHOLDER = 'Search title/path/Agent/machine/ID…'

afterEach(() => cleanup())

function makeSession(overrides: Record<string, unknown> & { id: string }) {
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

function renderSessionList(api: ApiClient | null, onSelect: (sessionId: string) => void = vi.fn()) {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
    })
    const ui = (
        <QueryClientProvider client={queryClient}>
            <ToastProvider>
                <I18nProvider>
                    <AppContextTestProvider>
                        <SessionList
                            sessions={[makeSession({
                                id: 'session-1',
                                updatedAt: 100,
                                metadata: { path: '/work/hapi', machineId: 'machine-1', agentSessionId: 'thread-1', name: 'Alpha task' }
                            })]}
                            selectedSessionId={null}
                            onSelect={onSelect}
                            onNewSession={vi.fn()}
                            onRefresh={vi.fn()}
                            isLoading={false}
                            renderHeader={false}
                            api={api}
                            machineLabelsById={{ 'machine-1': 'Mint' }}
                        />
                    </AppContextTestProvider>
                </I18nProvider>
            </ToastProvider>
        </QueryClientProvider>
    )
    render(ui)
}

function typeQuery(value: string) {
    fireEvent.click(screen.getByRole('button', { name: SEARCH_LABEL }))
    fireEvent.change(screen.getByPlaceholderText(SEARCH_PLACEHOLDER), { target: { value } })
}

function makeHit(messageId: string, snippet: string, matchStart: number, matchLength: number, role: 'user' | 'agent' = 'user') {
    return {
        sessionId: 'session-1',
        messageId,
        seq: 1,
        role,
        createdAt: Date.now() - 60_000,
        snippet,
        matchStart,
        matchLength
    }
}

function hitByMessageId(hits: ReturnType<typeof makeHit>[], messageId: string) {
    const hit = hits.find((candidate) => candidate.messageId === messageId)
    if (!hit) throw new Error(`missing hit ${messageId}`)
    return hit
}

async function openMessagesTab(expectedTotal: number) {
    const tab = await waitFor(() => screen.getByRole('tab', { name: `Messages (${expectedTotal})` }))
    fireEvent.click(tab)
}

describe('SessionList message search section', () => {
    it('splits search into tabs, groups hits per chat and pages older matches', async () => {
        const onSelect = vi.fn()
        const previews = [
            makeHit('m1', 'Готово: регистрация готова', 8, 11, 'user'),
            makeHit('m2', 'почини регистрацию сегодня', 7, 12),
            makeHit('m3', 'регистрации ожидайте вечером', 0, 11, 'agent')
        ]
        const expandedHits = [...previews, makeHit('m4', 'вторая Регистрация в истории', 7, 11)]
        // The cursor page carries only the new tail, like the real endpoint.
        const moreHits = [makeHit('m5', 'третья registraciya рядом', 7, 11), makeHit('m6', 'четвёртая registraciya тут', 10, 11)]
        const mainResponse: MessageSearchResponse = {
            total: 6,
            hits: previews,
            sessions: [{ sessionId: 'session-1', count: 6 }],
            hasMore: false
        }
        const api = {
            searchMessages: vi.fn()
                .mockResolvedValueOnce(mainResponse)
                .mockResolvedValueOnce({ total: 6, hits: expandedHits, sessions: [], hasMore: true })
                .mockResolvedValueOnce({ total: 6, hits: moreHits, sessions: [], hasMore: false })
        } as unknown as ApiClient

        renderSessionList(api, onSelect)
        typeQuery('регистрация')

        await waitFor(() => expect(api.searchMessages).toHaveBeenCalledWith('регистрация', expect.objectContaining({ limit: 30 })))
        // The chats tab is the default, so the message results stay hidden even
        // after the response has landed and fed the tab badge.
        expect(screen.getByRole('tab', { name: 'Chats (0)', selected: true })).toBeTruthy()
        expect(screen.queryByTestId('message-search-results')).toBeNull()

        await openMessagesTab(6)
        const group = await waitFor(() => screen.getByTestId('message-search-session-session-1'))
        // The chat group carries the session title and the full match count.
        expect(screen.getByText('Alpha task')).toBeTruthy()
        // Tab badge + section header + group header.
        expect(screen.getAllByText('(6)')).toHaveLength(3)
        // Group header + 3 preview hits + the expander row.
        expect(within(group).getAllByRole('button')).toHaveLength(5)
        expect(screen.getByText('+3 more in this chat')).toBeTruthy()

        fireEvent.click(screen.getByText('+3 more in this chat'))
        await waitFor(() => expect(api.searchMessages).toHaveBeenNthCalledWith(2, 'регистрация', expect.objectContaining({ sessionId: 'session-1', limit: 100 })))
        await waitFor(() => expect(screen.getByText('Регистрация')).toBeTruthy())
        // Group header + 4 hits + the load-more row.
        expect(within(group).getAllByRole('button')).toHaveLength(6)
        expect(screen.getByText('Load more')).toBeTruthy()

        fireEvent.click(screen.getByText('Load more'))
        const lastExpanded = hitByMessageId(expandedHits, 'm4')
        await waitFor(() => expect(api.searchMessages).toHaveBeenNthCalledWith(3, 'регистрация', expect.objectContaining({
            sessionId: 'session-1',
            beforeCreatedAt: lastExpanded.createdAt,
            beforeSeq: lastExpanded.seq
        })))
        await waitFor(() => expect(within(group).getAllByRole('button')).toHaveLength(7))
        expect(screen.queryByText('Load more')).toBeNull()

        // A hit opens its session.
        fireEvent.click(screen.getByText('регистрация'))
        expect(onSelect).toHaveBeenCalledWith('session-1')

        // Switching back to the chats tab restores the session sections.
        fireEvent.click(screen.getByRole('tab', { name: 'Chats (0)' }))
        await waitFor(() => expect(screen.queryByTestId('message-search-results')).toBeNull())
    })

    it('shows an empty hint when messages match nothing', async () => {
        const api = {
            searchMessages: vi.fn().mockResolvedValue({ total: 0, hits: [], sessions: [], hasMore: false })
        } as unknown as ApiClient

        renderSessionList(api)
        typeQuery('регистрация')

        await openMessagesTab(0)
        await waitFor(() => expect(screen.getByText('No matching messages')).toBeTruthy())
    })

    it('stays hidden for short queries', async () => {
        const api = { searchMessages: vi.fn().mockResolvedValue({ total: 0, hits: [], sessions: [], hasMore: false }) } as unknown as ApiClient

        renderSessionList(api)
        typeQuery('a')

        await waitFor(() => expect(screen.queryByTestId('message-search-results')).toBeNull())
        expect(api.searchMessages).not.toHaveBeenCalled()
    })
})
