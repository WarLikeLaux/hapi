import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactElement } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nProvider } from '@/lib/i18n-context'
import type { ApiClient } from '@/api/client'
import type { WorkspaceTurnDiffResponse } from '@hapi/protocol/apiTypes'
import { ResponseChanges } from './ResponseChanges'

afterEach(() => cleanup())

const PENDING_CHANGES = {
    diff: null,
    filesChanged: 2,
    additions: 3,
    deletions: 1,
    pending: true,
}

function renderWithQuery(ui: ReactElement): void {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
    })
    render(
        <QueryClientProvider client={queryClient}>
            <I18nProvider>
                {ui}
            </I18nProvider>
        </QueryClientProvider>
    )
}

describe('ResponseChanges', () => {
    it('shows per-step stats and opens the persisted unified diff', () => {
        renderWithQuery(
            <ResponseChanges changes={{
                diff: 'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+new\n',
                filesChanged: 1,
                additions: 1,
                deletions: 1,
            }} />
        )

        const button = screen.getByRole('button', { name: 'Show changes' })
        const fileCount = screen.getByText('· 1')
        expect(fileCount).toHaveClass('hidden', 'sm:inline')
        expect(button).toHaveTextContent('+1')
        expect(button).toHaveTextContent('−1')

        fireEvent.click(button)

        expect(screen.getByRole('dialog')).toBeInTheDocument()
        expect(screen.getByText('Changes in this step')).toBeInTheDocument()
        expect(screen.getByText('+new')).toBeInTheDocument()
        expect(screen.getByText('-old')).toBeInTheDocument()
    })

    it('keeps the summary available when the stored diff exceeded the limit', () => {
        renderWithQuery(
            <ResponseChanges changes={{
                diff: null,
                filesChanged: 4,
                additions: 500,
                deletions: 20,
                truncated: true,
            }} />
        )

        fireEvent.click(screen.getByRole('button', { name: 'Show changes' }))

        expect(screen.getByText(/diff is too large/i)).toBeInTheDocument()
        expect(screen.getByText('Files: 4')).toBeInTheDocument()
    })

    it('fetches the current diff on open for pending in-turn stats', async () => {
        const getWorkspaceTurnChanges = vi.fn(async (): Promise<WorkspaceTurnDiffResponse> => ({
            success: true,
            changes: {
                diff: 'diff --git a/live.ts b/live.ts\n--- a/live.ts\n+++ b/live.ts\n@@ -1 +1 @@\n-old\n+live\n',
                filesChanged: 2,
                additions: 5,
                deletions: 1,
            },
        }))
        const api = { getWorkspaceTurnChanges } as unknown as ApiClient

        renderWithQuery(
            <ResponseChanges changes={PENDING_CHANGES} api={api} sessionId='session-1' />
        )

        fireEvent.click(screen.getByRole('button', { name: 'Show changes' }))

        expect(await screen.findByText('Loading current diff…')).toBeInTheDocument()
        await waitFor(() => {
            expect(api.getWorkspaceTurnChanges).toHaveBeenCalledWith('session-1')
        })
        expect(await screen.findByText('+live')).toBeInTheDocument()
        expect(await screen.findByText('-old')).toBeInTheDocument()
        // Header stats switch to the fetched numbers.
        expect(screen.getByText('Files: 2')).toBeInTheDocument()
    })

    it('shows the unavailable hint when the turn ended before the fetch', async () => {
        const api = {
            getWorkspaceTurnChanges: vi.fn(async (): Promise<WorkspaceTurnDiffResponse> => ({
                success: true,
                changes: null,
            })),
        } as unknown as ApiClient

        renderWithQuery(
            <ResponseChanges changes={PENDING_CHANGES} api={api} sessionId='session-1' />
        )

        fireEvent.click(screen.getByRole('button', { name: 'Show changes' }))

        expect(await screen.findByText('No active changes — the turn has ended.')).toBeInTheDocument()
    })

    it('shows the failure hint when the fetch errors', async () => {
        const api = {
            getWorkspaceTurnChanges: vi.fn(async (): Promise<WorkspaceTurnDiffResponse> => {
                throw new Error('offline')
            }),
        } as unknown as ApiClient

        renderWithQuery(
            <ResponseChanges changes={PENDING_CHANGES} api={api} sessionId='session-1' />
        )

        fireEvent.click(screen.getByRole('button', { name: 'Show changes' }))

        expect(await screen.findByText(/Could not load the current diff/i)).toBeInTheDocument()
    })
})
