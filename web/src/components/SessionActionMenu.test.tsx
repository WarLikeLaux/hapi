import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { I18nProvider } from '@/lib/i18n-context'
import { SessionActionMenu } from '@/components/SessionActionMenu'
import { SESSION_REFERENCE_STEER_SUFFIX } from '@hapi/protocol/sessionCitation'

vi.mock('@/hooks/usePlatform', () => ({
    usePlatform: () => ({
        haptic: { notification: vi.fn(), impact: vi.fn() },
    }),
}))

afterEach(() => cleanup())

function renderMenuDefaults(): React.ComponentProps<typeof SessionActionMenu> {
    return {
        isOpen: true,
        onClose: vi.fn(),
        sessionId: 'sess-123',
        sessionTitle: 'Test session',
        sessionActive: false,
        onRename: vi.fn(),
        onArchive: vi.fn(),
        onReopen: vi.fn(),
        onDelete: vi.fn(),
        anchorPoint: { x: 0, y: 0 },
    }
}

function renderMenu(overrides: Partial<React.ComponentProps<typeof SessionActionMenu>> = {}) {
    const defaults = renderMenuDefaults()
    const merged = { ...defaults, ...overrides }
    return {
        ...render(
            <I18nProvider>
                <SessionActionMenu {...merged} />
            </I18nProvider>
        ),
        props: merged
    }
}

beforeEach(() => {
    vi.clearAllMocks()
})

describe('SessionActionMenu - Pin action', () => {
    it('renders project and global pin actions', () => {
        const onSetPinMode = vi.fn()
        const { rerender } = renderMenu({ onSetPinMode, sessionPinned: false, sessionGlobalPinned: false })

        fireEvent.click(screen.getByRole('menuitem', { name: 'Pin in project' }))
        expect(onSetPinMode).toHaveBeenCalledWith('project')

        fireEvent.click(screen.getByRole('menuitem', { name: 'Pin globally' }))
        expect(onSetPinMode).toHaveBeenCalledWith('global')

        rerender(
            <I18nProvider>
                <SessionActionMenu
                    isOpen={true}
                    onClose={vi.fn()}
                    sessionId="session-1"
                    sessionTitle="Session 1"
                    sessionActive={false}
                    sessionPinned={true}
                    sessionGlobalPinned={true}
                    onSetPinMode={onSetPinMode}
                    onRename={vi.fn()}
                    onArchive={vi.fn()}
                    onDelete={vi.fn()}
                    anchorPoint={{ x: 0, y: 0 }}
                />
            </I18nProvider>
        )
        expect(screen.getByRole('menuitem', { name: 'Unpin from project' })).toBeInTheDocument()
        expect(screen.getByRole('menuitem', { name: 'Unpin globally' })).toBeInTheDocument()
    })
})

describe('SessionActionMenu - Mark unread action', () => {
    it('fires the mark-unread handler and closes the menu', () => {
        const onMarkUnread = vi.fn()
        const onClose = vi.fn()
        renderMenu({ onMarkUnread, onClose })

        fireEvent.click(screen.getByRole('menuitem', { name: 'Mark as unread' }))

        expect(onMarkUnread).toHaveBeenCalledTimes(1)
        expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('does not render the action when no handler is provided', () => {
        renderMenu()

        expect(screen.queryByRole('menuitem', { name: 'Mark as unread' })).toBeNull()
    })
})

describe('SessionActionMenu - regenerate title action', () => {
    it('fires the regenerate handler and closes the menu', () => {
        const onRegenerateTitle = vi.fn()
        const onClose = vi.fn()
        renderMenu({ onRegenerateTitle, onClose })

        fireEvent.click(screen.getByRole('menuitem', { name: 'Regenerate title' }))

        expect(onRegenerateTitle).toHaveBeenCalledOnce()
        expect(onClose).toHaveBeenCalledOnce()
    })

    it('does not render the action when no handler is provided', () => {
        renderMenu()

        expect(screen.queryByRole('menuitem', { name: 'Regenerate title' })).toBeNull()
    })
})

describe('SessionActionMenu - Continue in folder action', () => {
    it('fires the continuation handler and closes the menu', () => {
        const onContinueInFolder = vi.fn()
        const onClose = vi.fn()
        renderMenu({ onContinueInFolder, onClose })

        fireEvent.click(screen.getByRole('menuitem', { name: 'Continue in another folder' }))

        expect(onContinueInFolder).toHaveBeenCalledOnce()
        expect(onClose).toHaveBeenCalledOnce()
    })
})

describe('SessionActionMenu - positioning', () => {
    it('centers the menu on the supplied anchor', () => {
        const originalInnerWidth = window.innerWidth
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 })
        const menuRect = {
            bottom: 320,
            height: 320,
            left: 0,
            right: 240,
            top: 0,
            width: 240,
            x: 0,
            y: 0,
            toJSON: () => ({})
        } as DOMRect
        const getBoundingClientRect = vi
            .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
            .mockReturnValue(menuRect)

        try {
            renderMenu({ anchorPoint: { x: 160, y: 100 } })

            const menu = screen.getByRole('menu').parentElement
            expect(menu).toHaveClass('w-max')
            expect(menu).toHaveStyle({ left: '40px' })
            expect(screen.getAllByRole('menuitem')[0]).toHaveClass('pl-3', 'pr-[42px]')
        } finally {
            getBoundingClientRect.mockRestore()
            Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalInnerWidth })
        }
    })

    it('clamps the trigger-centered menu at the viewport edge', () => {
        const originalInnerWidth = window.innerWidth
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 })
        const menuRect = {
            bottom: 320,
            height: 320,
            left: 0,
            right: 240,
            top: 0,
            width: 240,
            x: 0,
            y: 0,
            toJSON: () => ({})
        } as DOMRect
        const getBoundingClientRect = vi
            .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
            .mockReturnValue(menuRect)

        try {
            renderMenu({ anchorPoint: { x: 100, y: 100 } })

            expect(screen.getByRole('menu').parentElement).toHaveStyle({ left: '8px' })
        } finally {
            getBoundingClientRect.mockRestore()
            Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalInnerWidth })
        }
    })
})

describe('SessionActionMenu - Reopen action', () => {
    it('renders the Reopen item on inactive sessions when onReopen is provided', () => {
        renderMenu({ sessionActive: false })

        expect(screen.getByRole('menuitem', { name: /Reopen/ })).toBeInTheDocument()
    })

    it('does not render the Reopen item on active sessions', () => {
        renderMenu({ sessionActive: true })

        expect(screen.queryByRole('menuitem', { name: /Reopen/ })).toBeNull()
    })

    it('offers restart for active sessions and closes the menu when selected', () => {
        const onRestart = vi.fn()
        const onClose = vi.fn()
        renderMenu({ sessionActive: true, onRestart, onClose })

        fireEvent.click(screen.getByRole('menuitem', { name: 'Restart session' }))

        expect(onRestart).toHaveBeenCalledOnce()
        expect(onClose).toHaveBeenCalledOnce()
    })

    it('does not render the Reopen item when onReopen is omitted (back-compat)', () => {
        renderMenu({ sessionActive: false, onReopen: undefined })

        expect(screen.queryByRole('menuitem', { name: /Reopen/ })).toBeNull()
        // Delete item is still present for inactive sessions.
        expect(screen.getByRole('menuitem', { name: /Delete/ })).toBeInTheDocument()
    })

    it('renders a disabled Reopen item with an explanation when resume data is missing', () => {
        const onClose = vi.fn()
        renderMenu({
            sessionActive: false,
            onReopen: undefined,
            reopenDisabledReason: 'Cursor chat data is no longer available on this machine.',
            onClose,
        })

        const reopen = screen.getByRole('menuitem', { name: /Reopen/ })
        expect(reopen).toHaveAttribute('aria-disabled', 'true')
        expect(screen.getByRole('tooltip')).toHaveTextContent('Cursor chat data is no longer available')

        fireEvent.click(reopen)
        expect(onClose).not.toHaveBeenCalled()
    })

    it('keeps Reopen enabled with a soft-fail hint when probe is unverified', () => {
        const onReopen = vi.fn()
        renderMenu({
            sessionActive: false,
            onReopen,
            reopenHint: 'Could not verify Cursor chat data (runner may be outdated).',
        })

        const reopen = screen.getByRole('menuitem', { name: /Reopen/ })
        expect(reopen).not.toHaveAttribute('aria-disabled', 'true')
        expect(screen.getByRole('tooltip')).toHaveTextContent('Could not verify Cursor chat data')

        fireEvent.click(reopen)
        expect(onReopen).toHaveBeenCalledTimes(1)
    })

    it('fires onReopen and closes the menu when the Reopen item is clicked', () => {
        const onReopen = vi.fn()
        const onClose = vi.fn()
        renderMenu({ sessionActive: false, onReopen, onClose })

        fireEvent.click(screen.getByRole('menuitem', { name: /Reopen/ }))

        expect(onReopen).toHaveBeenCalledTimes(1)
        expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('renders Reopen alongside Delete for inactive sessions', () => {
        renderMenu({ sessionActive: false })

        expect(screen.getByRole('menuitem', { name: /Reopen/ })).toBeInTheDocument()
        expect(screen.getByRole('menuitem', { name: /Delete/ })).toBeInTheDocument()
        // Stop should not show up for sessions that are already inactive.
        expect(screen.queryByRole('menuitem', { name: /Stop session/ })).toBeNull()
    })

    it('stops an active session through the existing safe archive flow', () => {
        const onArchive = vi.fn()
        const onClose = vi.fn()
        renderMenu({ sessionActive: true, onArchive, onClose })

        fireEvent.click(screen.getByRole('menuitem', { name: 'Stop session' }))

        expect(onArchive).toHaveBeenCalledTimes(1)
        expect(onClose).toHaveBeenCalledTimes(1)
    })
})

describe('SessionActionMenu - Codex sync action', () => {
    it('renders Sync Codex only when a handler is provided', () => {
        const { rerender } = renderMenu({ onSyncCodex: undefined })

        expect(screen.queryByRole('menuitem', { name: /Sync Codex/ })).toBeNull()

        rerender(
            <I18nProvider>
                <SessionActionMenu
                    isOpen={true}
                    onClose={vi.fn()}
                    sessionId="sess-123"
                    sessionTitle="Test session"
                    sessionActive={false}
                    onRename={vi.fn()}
                    onExport={vi.fn()}
                    onSyncCodex={vi.fn()}
                    onArchive={vi.fn()}
                    onReopen={vi.fn()}
                    onDelete={vi.fn()}
                    anchorPoint={{ x: 0, y: 0 }}
                />
            </I18nProvider>
        )

        expect(screen.getByRole('menuitem', { name: /Sync Codex/ })).toBeInTheDocument()
    })

    it('fires onSyncCodex and closes the menu when clicked', () => {
        const onSyncCodex = vi.fn()
        const onClose = vi.fn()
        renderMenu({ onSyncCodex, onClose })

        fireEvent.click(screen.getByRole('menuitem', { name: /Sync Codex/ }))

        expect(onSyncCodex).toHaveBeenCalledTimes(1)
        expect(onClose).toHaveBeenCalledTimes(1)
    })
})

describe('SessionActionMenu - Pi sync action', () => {
    it('renders, fires, and closes Sync Pi history when a handler is provided', () => {
        const onSyncPi = vi.fn()
        const onClose = vi.fn()
        renderMenu({ onSyncPi, onClose })

        fireEvent.click(screen.getByRole('menuitem', { name: /Sync Pi history/ }))

        expect(onSyncPi).toHaveBeenCalledOnce()
        expect(onClose).toHaveBeenCalledOnce()
    })

    it('hides Sync Pi history when no handler is provided', () => {
        renderMenu({ onSyncPi: undefined })
        expect(screen.queryByRole('menuitem', { name: /Sync Pi history/ })).toBeNull()
    })
})

describe('SessionActionMenu - DIFIT actions', () => {
    it('starts a new review and switches to restart after a review is attached', () => {
        const onManageDifit = vi.fn()
        const onClose = vi.fn()
        const { rerender } = renderMenu({ onManageDifit, onClose })

        const startAction = screen.getByRole('menuitem', { name: 'Start DIFIT' })
        const items = screen.getAllByRole('menuitem')
        expect(items.indexOf(startAction)).toBeLessThan(
            items.indexOf(screen.getByRole('menuitem', { name: 'Rename' }))
        )

        fireEvent.click(startAction)
        expect(onManageDifit).toHaveBeenCalledOnce()
        expect(onClose).toHaveBeenCalledOnce()

        rerender(
            <I18nProvider>
                <SessionActionMenu
                    {...renderMenuDefaults()}
                    isOpen={true}
                    onManageDifit={onManageDifit}
                    difitAttached={true}
                />
            </I18nProvider>
        )
        expect(screen.getByRole('menuitem', { name: 'Restart DIFIT' })).toBeInTheDocument()
    })

    it('exposes the merge-request link without duplicating the header DIFIT link', () => {
        renderMenu({
            externalReviewUrl: 'https://gitlab.example.test/group/project/-/merge_requests/1',
            createExternalReviewUrl: 'https://gitlab.example.test/group/project/-/merge_requests/new',
        })

        expect(screen.queryByRole('menuitem', { name: 'Open in DIFIT' })).toBeNull()
        expect(screen.getByRole('menuitem', { name: 'Open PR' })).toHaveAttribute(
            'href',
            'https://gitlab.example.test/group/project/-/merge_requests/1'
        )
        expect(screen.queryByRole('menuitem', { name: 'Create PR' })).toBeNull()
    })

    it('offers review creation when no external review is attached', () => {
        const onClose = vi.fn()
        renderMenu({
            createExternalReviewUrl: 'https://gitlab.example.test/group/project/-/merge_requests/new?merge_request%5Bsource_branch%5D=feature',
            onClose,
        })

        const createAction = screen.getByRole('menuitem', { name: 'Create PR' })
        expect(createAction).toHaveAttribute(
            'href',
            'https://gitlab.example.test/group/project/-/merge_requests/new?merge_request%5Bsource_branch%5D=feature'
        )
        expect(createAction).toHaveAttribute('target', '_blank')
        expect(screen.getAllByRole('menuitem').indexOf(createAction)).toBeLessThan(
            screen.getAllByRole('menuitem').indexOf(screen.getByRole('menuitem', { name: 'Rename' }))
        )

        fireEvent.click(createAction)
        expect(onClose).toHaveBeenCalledOnce()
    })
})

describe('SessionActionMenu - Copy reference action', () => {
    it('renders the Copy reference item', () => {
        renderMenu()

        expect(screen.getByRole('menuitem', { name: /Copy reference/ })).toBeInTheDocument()
    })

    it('copies a session citation and closes the menu when Copy reference is clicked', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined)
        Object.defineProperty(navigator, 'clipboard', {
            value: { writeText },
            configurable: true,
        })

        const onClose = vi.fn()
        renderMenu({
            sessionId: 'abc-def',
            sessionTitle: 'upstream issue/pr discovery',
            onClose,
        })

        fireEvent.click(screen.getByRole('menuitem', { name: /Copy reference/ }))

        expect(onClose).toHaveBeenCalledTimes(1)
        await vi.waitFor(() => {
            expect(writeText).toHaveBeenCalledWith(
                `See session "upstream issue/pr discovery" (/sessions/abc-def) for context.${SESSION_REFERENCE_STEER_SUFFIX}`
            )
        })
    })
})
