import {
    useEffect,
    useId,
    useLayoutEffect,
    useRef,
    useState,
    type CSSProperties,
    type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { useTranslation } from '@/lib/use-translation'
import { HoverTooltip } from '@/components/HoverTooltip'
import { safeCopyToClipboard } from '@/lib/clipboard'
import { buildSessionReferenceText } from '@/lib/sessionReference'
import { usePlatform } from '@/hooks/usePlatform'
import { useAnchoredMenu } from '@/hooks/useAnchoredMenu'
import { CopyIcon } from '@/components/icons'
import { SESSION_CONTEXTS, type SessionContextId } from '@/lib/sessionContexts'

type SessionActionMenuProps = {
    isOpen: boolean
    onClose: () => void
    sessionId: string
    sessionTitle: string
    sessionActive: boolean
    onRename: () => void
    onRegenerateTitle?: () => void
    sessionPinned?: boolean
    sessionGlobalPinned?: boolean
    onSetPinMode?: (mode: 'none' | 'project' | 'global') => void
    currentContext?: SessionContextId
    onSetContext?: (context: SessionContextId | null) => void
    onExport?: () => void
    onMarkUnread?: () => void
    onSyncCodex?: () => void
    onSyncPi?: () => void
    externalReviewUrl?: string | null
    difitOpenUrl?: string | null
    createExternalReviewUrl?: string | null
    onContinueInFolder?: () => void
    onRestart?: () => void
    onArchive: () => void
    onReopen?: () => void
    reopenDisabledReason?: string
    /** Soft-fail tip when reopen is allowed but chat-store probe could not verify. */
    reopenHint?: string
    onDelete: () => void
    anchorPoint: { x: number; y: number }
    menuId?: string
}

function EditIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
            <path d="m15 5 4 4" />
        </svg>
    )
}

function UnreadIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            className={props.className}
        >
            <circle cx="12" cy="12" r="4" fill="currentColor" />
        </svg>
    )
}

function PinIcon(props: { className?: string; filled?: boolean }) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"
            fill={props.filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round" className={props.className}>
            <path d="M12 17v5" />
            <path d="M5 17h14" />
            <path d="M7 4V2h10v2l-2 5v4l2 2H7l2-2V9Z" />
        </svg>
    )
}

function StopIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <rect width="14" height="14" x="5" y="5" rx="2" />
        </svg>
    )
}

function ContinueInFolderIcon(props: { className?: string }) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            className={props.className}>
            <path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
            <path d="m9 13 2 2 4-4" />
        </svg>
    )
}

function DownloadIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" x2="12" y1="15" y2="3" />
        </svg>
    )
}

function ReopenIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
            <path d="M3 3v5h5" />
        </svg>
    )
}

function SyncIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
            <path d="M21 3v5h-5" />
            <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
            <path d="M3 21v-5h5" />
        </svg>
    )
}

function DifitIcon(props: { className?: string }) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            className={props.className}>
            <path d="M10 7H3m0 0 3-3M3 7l3 3" />
            <path d="M14 17h7m0 0-3-3m3 3-3 3" />
            <path d="M12 4v16" opacity="0.45" />
        </svg>
    )
}

function ExternalReviewIcon(props: { className?: string }) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            className={props.className}>
            <circle cx="6" cy="5" r="2" />
            <circle cx="6" cy="19" r="2" />
            <circle cx="18" cy="5" r="2" />
            <path d="M6 7v10" />
            <path d="M18 7v3a4 4 0 0 1-4 4H9" />
            <path d="m11 11-3 3 3 3" />
        </svg>
    )
}

function TrashIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <path d="M3 6h18" />
            <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
            <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
            <line x1="10" x2="10" y1="11" y2="17" />
            <line x1="14" x2="14" y1="11" y2="17" />
        </svg>
    )
}

function TagIcon(props: { className?: string }) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round" className={props.className}>
            <path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z" />
            <circle cx="7.5" cy="7.5" r=".5" fill="currentColor" />
        </svg>
    )
}

function ChevronRightIcon(props: { className?: string }) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round" className={props.className}>
            <path d="m9 18 6-6-6-6" />
        </svg>
    )
}

function CheckIcon(props: { className?: string }) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round" className={props.className}>
            <path d="M20 6 9 17l-5-5" />
        </svg>
    )
}

function NoContextIcon(props: { className?: string }) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round" className={props.className}>
            <circle cx="12" cy="12" r="10" />
            <path d="m4.9 4.9 14.2 14.2" />
        </svg>
    )
}

export function SessionActionMenu(props: SessionActionMenuProps) {
    const { t } = useTranslation()
    const { haptic } = usePlatform()
    const {
        isOpen,
        onClose,
        sessionId,
        sessionTitle,
        sessionActive,
        onRename,
        onRegenerateTitle,
        sessionPinned = false,
        sessionGlobalPinned = false,
        onSetPinMode,
        currentContext,
        onSetContext,
        onExport,
        onMarkUnread,
        onSyncCodex,
        onSyncPi,
        externalReviewUrl,
        difitOpenUrl,
        createExternalReviewUrl,
        onContinueInFolder,
        onRestart,
        onArchive,
        onReopen,
        reopenDisabledReason,
        reopenHint,
        onDelete,
        anchorPoint,
        menuId
    } = props
    const { menuRef, menuStyle } = useAnchoredMenu({ isOpen, onClose, anchorPoint })
    const internalId = useId()
    const resolvedMenuId = menuId ?? `session-action-menu-${internalId}`
    const headingId = `${resolvedMenuId}-heading`

    // Context flyout: opens on hover or click next to the Context item.
    const [contextOpen, setContextOpen] = useState(false)
    const [contextSubmenuStyle, setContextSubmenuStyle] = useState<CSSProperties>({})
    const contextCloseTimer = useRef<number | null>(null)
    const contextItemRef = useRef<HTMLButtonElement | null>(null)
    const contextSubmenuRef = useRef<HTMLDivElement | null>(null)

    useEffect(() => {
        if (isOpen) return
        setContextOpen(false)
        if (contextCloseTimer.current !== null) {
            window.clearTimeout(contextCloseTimer.current)
            contextCloseTimer.current = null
        }
    }, [isOpen])

    // Keep the flyout inside the viewport: prefer the menu's outer right
    // edge, fall back to the left side of the menu, and on narrow screens
    // clamp it back inside so it stays visible even if it overlaps the menu.
    useLayoutEffect(() => {
        if (!contextOpen) return
        const item = contextItemRef.current
        const submenu = contextSubmenuRef.current
        if (!item || !submenu) return
        const itemRect = item.getBoundingClientRect()
        const submenuRect = submenu.getBoundingClientRect()
        const padding = 8
        // The wrapper ends inside the menu's border (1px) and padding (4px),
        // so a 4px gap would leave the flyout overlapping the menu edge; 5px
        // puts it flush with the menu's outer right border.
        const submenuGap = 5

        let viewportLeft = itemRect.right + submenuGap
        if (viewportLeft + submenuRect.width > window.innerWidth - padding) {
            viewportLeft = itemRect.left - submenuGap - submenuRect.width
        }
        viewportLeft = Math.max(viewportLeft, padding)

        let top = itemRect.top
        if (top + submenuRect.height > window.innerHeight - padding) {
            top = window.innerHeight - padding - submenuRect.height
        }

        setContextSubmenuStyle({
            left: `${viewportLeft - itemRect.left}px`,
            right: 'auto',
            top: `${Math.max(top, padding) - itemRect.top}px`,
        })
    }, [contextOpen])

    const clearContextCloseTimer = () => {
        if (contextCloseTimer.current !== null) {
            window.clearTimeout(contextCloseTimer.current)
            contextCloseTimer.current = null
        }
    }

    const openContextSubmenu = () => {
        clearContextCloseTimer()
        setContextOpen(true)
    }

    const scheduleContextSubmenuClose = () => {
        clearContextCloseTimer()
        contextCloseTimer.current = window.setTimeout(() => setContextOpen(false), 150)
    }

    const closeContextSubmenu = (refocusTrigger: boolean) => {
        clearContextCloseTimer()
        setContextOpen(false)
        if (refocusTrigger) contextItemRef.current?.focus()
    }

    const handleContextSelect = (context: SessionContextId | null) => {
        onClose()
        onSetContext?.(context)
    }

    const handleContextOptionKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
        if (event.key === 'Escape' || event.key === 'ArrowLeft') {
            event.preventDefault()
            event.stopPropagation()
            closeContextSubmenu(true)
        }
    }

    const handleRename = () => {
        onClose()
        onRename()
    }

    const handleRegenerateTitle = () => {
        onClose()
        onRegenerateTitle?.()
    }

    const handleCopyReference = async () => {
        onClose()
        try {
            await safeCopyToClipboard(buildSessionReferenceText(sessionTitle, sessionId))
            haptic.notification('success')
        } catch {
            haptic.notification('error')
        }
    }

    const handleSetPinMode = (mode: 'none' | 'project' | 'global') => {
        onClose()
        onSetPinMode?.(mode)
    }

    const handleArchive = () => {
        onClose()
        onArchive()
    }

    const handleRestart = () => {
        onClose()
        onRestart?.()
    }

    const handleReopen = () => {
        onClose()
        onReopen?.()
    }

    const handleExport = () => {
        onClose()
        onExport?.()
    }

    const handleMarkUnread = () => {
        onClose()
        onMarkUnread?.()
    }

    const handleSyncCodex = () => {
        onClose()
        onSyncCodex?.()
    }

    const handleSyncPi = () => {
        onClose()
        onSyncPi?.()
    }

    const handleContinueInFolder = () => {
        onClose()
        onContinueInFolder?.()
    }

    const handleDelete = () => {
        onClose()
        onDelete()
    }

    if (!isOpen) return null

    // The left text inset includes the icon and gap; mirror it on the right so
    // the text-to-border distance is symmetric without counting the icon twice.
    const baseItemClassName =
        'flex w-full items-center gap-3 rounded-md py-2 pl-3 pr-[42px] text-left text-base transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)]'

    // Submenu options keep the same left inset but a normal right inset; the
    // check mark sits at the trailing edge via ml-auto.
    const contextOptionClassName =
        'flex w-full items-center gap-3 rounded-md py-2 pl-3 pr-3 text-left text-base transition-colors hover:bg-[var(--app-subtle-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)]'

    // The Context trigger hugs its current value and chevron to the right
    // edge, so it uses a tight pr-2 instead of the mirrored text inset.
    const contextTriggerClassName =
        'flex w-full items-center gap-3 rounded-md py-2 pl-3 pr-2 text-left text-base transition-colors hover:bg-[var(--app-subtle-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)]'

    return (
        <div
            ref={menuRef}
            className="fixed z-50 box-border w-max max-w-[calc(100vw-16px)] rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] p-1 shadow-lg animate-menu-pop"
            style={menuStyle}
        >
            <div
                id={headingId}
                className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--app-hint)]"
            >
                {t('session.more')}
            </div>
            {onSetContext ? (
                <div
                    className="relative"
                    onPointerEnter={(event) => {
                        // Touch taps synthesize a mouse enter right before the
                        // click, which would instantly re-close the flyout;
                        // only react to real hovering pointers.
                        if (event.pointerType === 'mouse' || event.pointerType === 'pen') {
                            openContextSubmenu()
                        }
                    }}
                    onPointerLeave={(event) => {
                        if (event.pointerType === 'mouse' || event.pointerType === 'pen') {
                            scheduleContextSubmenuClose()
                        }
                    }}
                >
                    <button
                        ref={contextItemRef}
                        type="button"
                        role="menuitem"
                        aria-haspopup="menu"
                        aria-expanded={contextOpen}
                        className={contextTriggerClassName}
                        onClick={() => {
                            if (contextOpen) {
                                closeContextSubmenu(false)
                            } else {
                                openContextSubmenu()
                            }
                        }}
                        onKeyDown={(event) => {
                            if (event.key === 'ArrowRight' && !contextOpen) {
                                event.preventDefault()
                                openContextSubmenu()
                                const firstOption = contextSubmenuRef.current?.querySelector<HTMLElement>(
                                    '[role="menuitemradio"]'
                                )
                                firstOption?.focus()
                            }
                        }}
                    >
                        <TagIcon className="text-[var(--app-hint)]" />
                        {t('sessions.context.setLabel')}
                        <span className="ml-auto flex items-center gap-1.5 text-[var(--app-hint)]">
                            {currentContext && currentContext !== 'all' ? (
                                <>
                                    <span aria-hidden="true">
                                        {SESSION_CONTEXTS.find((ctx) => ctx.id === currentContext)?.icon}
                                    </span>
                                    {t(`sessions.context.${currentContext}`)}
                                </>
                            ) : (
                                t('sessions.context.none')
                            )}
                            <ChevronRightIcon />
                        </span>
                    </button>
                    {contextOpen ? (
                        <div
                            ref={contextSubmenuRef}
                            role="menu"
                            aria-label={t('sessions.context.setLabel')}
                            className="absolute left-full top-0 z-50 w-max min-w-40 rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] p-1 shadow-lg animate-menu-pop"
                            style={contextSubmenuStyle}
                        >
                            <button
                                type="button"
                                role="menuitemradio"
                                aria-checked={!currentContext || currentContext === 'all'}
                                className={contextOptionClassName}
                                onClick={() => handleContextSelect(null)}
                                onKeyDown={handleContextOptionKeyDown}
                            >
                                <NoContextIcon className="text-[var(--app-hint)]" />
                                {t('sessions.context.none')}
                                {!currentContext || currentContext === 'all' ? (
                                    <CheckIcon className="ml-auto text-[var(--app-link)]" />
                                ) : null}
                            </button>
                            {SESSION_CONTEXTS.filter((ctx) => ctx.id !== 'all').map((ctx) => {
                                const isCurrent = currentContext === ctx.id
                                return (
                                    <button
                                        key={ctx.id}
                                        type="button"
                                        role="menuitemradio"
                                        aria-checked={isCurrent}
                                        className={contextOptionClassName}
                                        onClick={() => handleContextSelect(ctx.id)}
                                        onKeyDown={handleContextOptionKeyDown}
                                    >
                                        <span
                                            aria-hidden="true"
                                            className="flex w-[18px] justify-center text-base leading-none"
                                        >
                                            {ctx.icon}
                                        </span>
                                        {t(ctx.labelKey)}
                                        {isCurrent ? <CheckIcon className="ml-auto text-[var(--app-link)]" /> : null}
                                    </button>
                                )
                            })}
                        </div>
                    ) : null}
                </div>
            ) : null}
            <div
                id={resolvedMenuId}
                role="menu"
                aria-labelledby={headingId}
                className="flex flex-col gap-1"
            >
                {difitOpenUrl ? (
                    <a
                        href={difitOpenUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        role="menuitem"
                        className={`${baseItemClassName} hover:bg-[var(--app-subtle-bg)]`}
                        onClick={onClose}
                    >
                        <DifitIcon className="text-[var(--app-hint)]" />
                        {t('session.action.openDifit')}
                    </a>
                ) : null}

                {externalReviewUrl ? (
                    <a
                        href={externalReviewUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        role="menuitem"
                        className={`${baseItemClassName} hover:bg-[var(--app-subtle-bg)]`}
                        onClick={onClose}
                    >
                        <ExternalReviewIcon className="text-[var(--app-hint)]" />
                        {t('session.action.openExternalReview')}
                    </a>
                ) : createExternalReviewUrl ? (
                    <a
                        href={createExternalReviewUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        role="menuitem"
                        className={`${baseItemClassName} hover:bg-[var(--app-subtle-bg)]`}
                        onClick={onClose}
                    >
                        <ExternalReviewIcon className="text-[var(--app-hint)]" />
                        {t('session.action.createExternalReview')}
                    </a>
                ) : null}

                <button
                    type="button"
                    role="menuitem"
                    className={`${baseItemClassName} hover:bg-[var(--app-subtle-bg)]`}
                    onClick={handleRename}
                >
                    <EditIcon className="text-[var(--app-hint)]" />
                    {t('session.action.rename')}
                </button>

                {onRegenerateTitle ? (
                    <button
                        type="button"
                        role="menuitem"
                        className={`${baseItemClassName} hover:bg-[var(--app-subtle-bg)]`}
                        onClick={handleRegenerateTitle}
                    >
                        <SyncIcon className="text-[var(--app-hint)]" />
                        {t('session.action.regenerateTitle')}
                    </button>
                ) : null}

                <button
                    type="button"
                    role="menuitem"
                    className={`${baseItemClassName} hover:bg-[var(--app-subtle-bg)]`}
                    onClick={() => void handleCopyReference()}
                >
                    <CopyIcon className="h-[18px] w-[18px] text-[var(--app-hint)]" />
                    {t('session.action.copyReference')}
                </button>

                {onContinueInFolder ? (
                    <button
                        type="button"
                        role="menuitem"
                        className={`${baseItemClassName} hover:bg-[var(--app-subtle-bg)]`}
                        onClick={handleContinueInFolder}
                    >
                        <ContinueInFolderIcon className="text-[var(--app-hint)]" />
                        {t('session.action.continueInFolder')}
                    </button>
                ) : null}

                {onMarkUnread ? (
                    <button
                        type="button"
                        role="menuitem"
                        className={`${baseItemClassName} hover:bg-[var(--app-subtle-bg)]`}
                        onClick={handleMarkUnread}
                    >
                        <UnreadIcon className="text-[var(--app-hint)]" />
                        {t('session.action.markUnread')}
                    </button>
                ) : null}

                {onSetPinMode ? (
                    <>
                        <button
                            type="button"
                            role="menuitem"
                            className={`${baseItemClassName} hover:bg-[var(--app-subtle-bg)]`}
                            onClick={() => handleSetPinMode(sessionPinned ? 'none' : 'project')}
                        >
                            <PinIcon filled={sessionPinned} className="text-[var(--app-hint)]" />
                            {t(sessionPinned ? 'session.action.unpinProject' : 'session.action.pinProject')}
                        </button>
                        <button
                            type="button"
                            role="menuitem"
                            className={`${baseItemClassName} hover:bg-[var(--app-subtle-bg)]`}
                            onClick={() => handleSetPinMode(sessionGlobalPinned ? 'none' : 'global')}
                        >
                            <PinIcon filled={sessionGlobalPinned} className="text-[var(--app-hint)]" />
                            {t(sessionGlobalPinned ? 'session.action.unpinGlobal' : 'session.action.pinGlobal')}
                        </button>
                    </>
                ) : null}

                {onExport ? (
                    <button
                        type="button"
                        role="menuitem"
                        className={`${baseItemClassName} hover:bg-[var(--app-subtle-bg)]`}
                        onClick={handleExport}
                    >
                        <DownloadIcon className="text-[var(--app-hint)]" />
                        {t('session.action.export')}
                    </button>
                ) : null}

                {onSyncCodex ? (
                    <button
                        type="button"
                        role="menuitem"
                        className={`${baseItemClassName} hover:bg-[var(--app-subtle-bg)]`}
                        onClick={handleSyncCodex}
                    >
                        <SyncIcon className="text-[var(--app-hint)]" />
                        {t('session.action.syncCodex')}
                    </button>
                ) : null}

                {onSyncPi ? (
                    <button
                        type="button"
                        role="menuitem"
                        className={`${baseItemClassName} hover:bg-[var(--app-subtle-bg)]`}
                        onClick={handleSyncPi}
                    >
                        <SyncIcon className="text-[var(--app-hint)]" />
                        {t('session.action.syncPi')}
                    </button>
                ) : null}

                {sessionActive ? (
                    <>
                        {onRestart ? (
                            <button
                                type="button"
                                role="menuitem"
                                className={`${baseItemClassName} hover:bg-[var(--app-subtle-bg)]`}
                                onClick={handleRestart}
                            >
                                <ReopenIcon className="text-[var(--app-hint)]" />
                                {t('session.action.restart')}
                            </button>
                        ) : null}
                        <button
                            type="button"
                            role="menuitem"
                            className={`${baseItemClassName} text-red-500 hover:bg-red-500/10`}
                            onClick={handleArchive}
                        >
                            <StopIcon className="text-red-500" />
                            {t('session.action.archive')}
                        </button>
                    </>
                ) : (
                    <>
                        {onReopen || reopenDisabledReason || reopenHint ? (
                            <HoverTooltip
                                id={`${resolvedMenuId}-reopen-tooltip`}
                                className="w-full [&>span:first-child]:w-full"
                                align="start"
                                revealOnParentFocusClass="group-focus-within:opacity-100 group-focus-within:visible"
                                target={(
                                    <button
                                        type="button"
                                        role="menuitem"
                                        aria-disabled={reopenDisabledReason ? true : undefined}
                                        aria-describedby={
                                            reopenDisabledReason || reopenHint
                                                ? `${resolvedMenuId}-reopen-tooltip`
                                                : undefined
                                        }
                                        className={`${baseItemClassName} ${reopenDisabledReason
                                            ? 'cursor-not-allowed opacity-50'
                                            : 'hover:bg-[var(--app-subtle-bg)]'}`}
                                        onClick={reopenDisabledReason ? undefined : handleReopen}
                                    >
                                        <ReopenIcon className="text-[var(--app-hint)]" />
                                        {t('session.action.reopen')}
                                    </button>
                                )}
                            >
                                {reopenDisabledReason ?? reopenHint ?? t('session.action.reopen')}
                            </HoverTooltip>
                        ) : null}
                        <button
                            type="button"
                            role="menuitem"
                            className={`${baseItemClassName} text-red-500 hover:bg-red-500/10`}
                            onClick={handleDelete}
                        >
                            <TrashIcon className="text-red-500" />
                            {t('session.action.delete')}
                        </button>
                    </>
                )}
            </div>
        </div>
    )
}
