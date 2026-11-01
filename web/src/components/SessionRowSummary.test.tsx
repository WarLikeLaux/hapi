import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionSummary } from '@/types/api'
import { I18nProvider } from '@/lib/i18n-context'
import { getProjectLabelHue, getSessionActivityTime, SessionRowSummary } from './SessionRowSummary'
import { markCodexSessionsImported } from '@/lib/codexImportedSessions'
import { configureSessionReadState, markSessionSeen, markSessionUnread } from '@/lib/sessionLastSeen'

afterEach(() => cleanup())

function makeSummary(overrides: Partial<SessionSummary> = {}): SessionSummary {
    return {
        id: 'background-demo',
        active: true,
        thinking: false,
        activeAt: 0,
        updatedAt: 0,
        metadata: { path: '/demo/status', name: 'Background demo', flavor: 'claude' },
        metadataVersion: 0,
        agentStateVersion: 0,
        todosUpdatedAt: 0,
        todoProgress: null,
        pendingRequestsCount: 0,
        pendingRequestKinds: [],
        pendingRequests: [],
        backgroundTaskCount: 2,
        futureScheduledMessageCount: 0,
        nextScheduledAt: null,
        model: null,
        effort: null,
        contentRevision: overrides.updatedAt ?? 0,
        ...overrides
    }
}

function renderSummary(showDetailedStatus: boolean) {
    return render(
        <I18nProvider>
            <SessionRowSummary
                session={makeSummary()}
                showDetailedStatus={showDetailedStatus}
            />
        </I18nProvider>
    )
}

describe('SessionRowSummary activity time', () => {
    it('uses the last user message for Working rows instead of agent churn', () => {
        const session = makeSummary({
            createdAt: 100,
            updatedAt: 900,
            lastUserMessageAt: 200,
            lastMessageAt: 800,
            lastAgentMessageAt: 800,
        })

        expect(getSessionActivityTime(session, 'user')).toBe(200)
        expect(getSessionActivityTime(session, 'agent')).toBe(800)
        expect(getSessionActivityTime(session)).toBe(800)
    })
})

describe('SessionRowSummary background status', () => {
    beforeEach(() => {
        localStorage.clear()
        configureSessionReadState('row-summary-test', async () => { throw new Error('offline') })()
    })

    it.each([false, true])('shows questions in a selected Working session (detailed: %s)', (showDetailedStatus) => {
        render(<I18nProvider><SessionRowSummary
            session={makeSummary({ thinking: true, pendingRequestsCount: 2, pendingAsyncQuestionsCount: 2,
                pendingRequestKinds: ['input'], backgroundTaskCount: 0 })}
            selected={true} showDetailedStatus={showDetailedStatus} nestedTooltips={false}
        /></I18nProvider>)
        expect(screen.getByRole('img', { name: 'Questions · 2' })).toBeVisible()
    })

    it('shows the basic running label in Basic mode', () => {
        renderSummary(false)

        expect(screen.getByText('Running', { exact: true })).toBeInTheDocument()
        expect(screen.queryByRole('tooltip', { hidden: true })).not.toBeInTheDocument()
    })

    it('shows project and Git branch together in top-list metadata', () => {
        render(
            <I18nProvider>
                <SessionRowSummary
                    session={makeSummary()}
                    projectLabel="hapi"
                    projectPath="/workspace/hapi"
                    branchLabel="custom"
                />
            </I18nProvider>
        )

        const metadata = screen.getByTitle('hapi — /workspace/hapi · custom')
        expect(metadata).toHaveTextContent('hapi')
        expect(metadata).toHaveTextContent('custom')
        expect(metadata).not.toHaveTextContent('·')
        const projectLabel = screen.getByTestId('session-project-label')
        expect(projectLabel).toHaveTextContent('hapi')
        expect(projectLabel.style.getPropertyValue('--session-project-bg')).toContain(
            `${getProjectLabelHue('/workspace/hapi')}`
        )
        expect(projectLabel).toHaveClass('bg-[var(--session-project-bg)]')
        expect(projectLabel).toHaveClass('rounded-[5px]')
        expect(projectLabel.parentElement).toHaveClass('text-[var(--app-hint)]')
    })

    it('assigns stable distinct colors from full project paths', () => {
        const apiHue = getProjectLabelHue('/workspace/project-api')
        const php8Hue = getProjectLabelHue('/workspace/project-api-v2')

        expect(apiHue).toBe(getProjectLabelHue('/workspace/project-api'))
        expect(apiHue).not.toBe(php8Hue)
    })

    it('shows a detailed background dot with the task-count tooltip in Extended mode', () => {
        renderSummary(true)

        expect(screen.queryByText('Running', { exact: true })).not.toBeInTheDocument()
        const tooltip = screen.getByRole('tooltip', { hidden: true })
        expect(tooltip).toHaveTextContent('Background tasks running')
        expect(tooltip).toHaveTextContent('2 tasks running')
    })

    it('refreshes unread attention when the local watermark version changes', () => {
        const session = makeSummary({
            active: false,
            backgroundTaskCount: 0,
            updatedAt: 2_000,
        })
        markSessionSeen(session.id, 2_000)
        const view = render(
            <I18nProvider>
                <SessionRowSummary
                    session={session}
                    showDetailedStatus={true}
                    lastSeenVersion={0}
                />
            </I18nProvider>
        )

        expect(screen.queryByRole('tooltip', { hidden: true })).not.toBeInTheDocument()

        markSessionUnread(session.id)
        view.rerender(
            <I18nProvider>
                <SessionRowSummary
                    session={session}
                    showDetailedStatus={true}
                    lastSeenVersion={1}
                />
            </I18nProvider>
        )

        expect(screen.getByRole('tooltip', { hidden: true })).toHaveTextContent('New activity')
    })

    it('keeps an explicit unread dot across newer activity', () => {
        const session = makeSummary({
            id: 'selected-unread',
            active: false,
            backgroundTaskCount: 0,
            updatedAt: 2_000,
        })
        markSessionSeen(session.id, 2_000)
        markSessionUnread(session.id)

        const view = render(
            <I18nProvider>
                <SessionRowSummary
                    session={session}
                    selected={true}
                    showDetailedStatus={true}
                    lastSeenVersion={0}
                />
            </I18nProvider>
        )

        expect(screen.getByRole('tooltip', { hidden: true })).toHaveTextContent('New activity')

        view.rerender(
            <I18nProvider>
                <SessionRowSummary
                    session={{ ...session, updatedAt: 2_001 }}
                    selected={true}
                    showDetailedStatus={true}
                    lastSeenVersion={1}
                />
            </I18nProvider>
        )

        expect(screen.getByRole('tooltip', { hidden: true })).toHaveTextContent('New activity')
    })

    it('shows an explicit unread dot before the thinking spinner', () => {
        const session = makeSummary({
            id: 'selected-thinking-unread',
            thinking: true,
            updatedAt: 2_000,
        })
        markSessionSeen(session.id, 2_000)
        markSessionUnread(session.id)

        render(
            <I18nProvider>
                <SessionRowSummary
                    session={session}
                    selected={true}
                    showDetailedStatus={true}
                    lastSeenVersion={0}
                />
            </I18nProvider>
        )

        expect(screen.getByRole('tooltip', { hidden: true })).toHaveTextContent('New activity')
    })
})

describe('SessionRowSummary time label', () => {
    beforeEach(() => {
        localStorage.clear()
        configureSessionReadState('row-summary-test', async () => { throw new Error('offline') })()
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    it('advances the relative time without a parent render', () => {
        vi.useFakeTimers()
        vi.setSystemTime(1_800_000_000_000)
        render(
            <I18nProvider>
                <SessionRowSummary session={makeSummary({ updatedAt: 1_800_000_000_000, backgroundTaskCount: 0 })} />
            </I18nProvider>
        )
        expect(screen.getByText('just now')).toBeInTheDocument()

        act(() => { vi.advanceTimersByTime(2 * 60_000) })
        expect(screen.getByText('2m ago')).toBeInTheDocument()
    })

    it('shows a Codex import marker set after the first render', () => {
        render(
            <I18nProvider>
                <SessionRowSummary session={makeSummary({
                    updatedAt: Date.now() - 3 * 60 * 60_000,
                    backgroundTaskCount: 0,
                    metadata: { path: '/demo', name: 'Imported', flavor: 'codex', agentSessionId: 'codex-thread' },
                })} />
            </I18nProvider>
        )
        expect(screen.queryByText('just imported from Codex')).toBeNull()

        act(() => { markCodexSessionsImported(['codex-thread']) })
        expect(screen.getByText('just imported from Codex')).toBeInTheDocument()
    })
})
