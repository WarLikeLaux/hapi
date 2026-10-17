import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useIsMutating, useQueryClient } from '@tanstack/react-query'
import type { Session } from '@/types/api'
import type { ApiClient } from '@/api/client'
import { isTelegramApp } from '@/hooks/useTelegram'
import { sessionModelMutationKey, useSessionActions } from '@/hooks/mutations/useSessionActions'
import { SessionActionMenu } from '@/components/SessionActionMenu'
import { useSessionContextFilter } from '@/hooks/useSessionContextFilter'
import { useSessionContextHubSync } from '@/hooks/useSessionContextHubSync'
import { resolveSessionContext } from '@/lib/sessionContexts'
import { SessionExportDialog } from '@/components/SessionExportDialog'
import { RenameSessionDialog } from '@/components/RenameSessionDialog'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useScratchlistCount } from '@/lib/use-scratchlist-count'
import { formatReopenError } from '@/lib/reopenError'
import { formatReasoningLabel, getReasoningEffortForFlavor } from '@/lib/codexStatusLabels'
import { modelChipText, prettyModelName } from '@/lib/modelChipLabel'
import { formatCodexReasoningEffortLabel } from '@/components/AssistantChat/codexReasoningEffortOptions'
import { retargetSharePendingTransfer } from '@/lib/sharePendingState'
import { useSessionModelLabel } from '@/hooks/useSessionModelLabel'
import { useTranslation } from '@/lib/use-translation'
import { AgentFlavorIcon } from '@/components/AgentFlavorIcon'
import { getProjectLabelHue } from '@/components/SessionRowSummary'
import { basename } from '@/utils/path'
import { isFastServiceTier } from '@/components/AssistantChat/codexFastMode'
import { getSessionTitle } from '@/lib/sessionTitle'
import { useToast } from '@/lib/toast-context'
import { queryKeys } from '@/lib/query-keys'
import { markCodexSessionsImported } from '@/lib/codexImportedSessions'
import { useMachines } from '@/hooks/queries/useMachines'
import { useMachineLabels } from '@/hooks/useMachineLabels'
import { useSessionHeaderMetadata } from '@/hooks/useSessionHeaderMetadata'
import { formatSessionHeaderTimestamp } from '@/lib/sessionHeaderTimestamp'
import { selectMobileSessionHeaderSecondary } from '@/lib/sessionHeaderMobileMetadata'
import { markSessionUnread } from '@/lib/sessionLastSeen'
import { usePlatform } from '@/hooks/usePlatform'
import { useNavigate } from '@tanstack/react-router'
import { useSessionGitBranch, useSessionGitLabCreateMergeRequestUrl, useSessionGitLabMergeRequestUrl } from '@/hooks/queries/useSessionGitBranch'
import { CodeIcon, GitLabIcon } from '@/components/icons'
import { buildExternalEditorFolderUrl } from '@/lib/external-editor-url'

function GitBranchIcon() {
    return (
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5 shrink-0">
            <line x1="6" y1="3" x2="6" y2="15" />
            <circle cx="18" cy="6" r="3" />
            <circle cx="6" cy="18" r="3" />
            <path d="M18 9a9 9 0 0 1-9 9" />
        </svg>
    )
}

/** Same preference order as session-list chips: display label → host → short id. */
export function resolveSessionHeaderMachineLabel(
    session: Session,
    labelsById: Record<string, string>
): string | null {
    const machineId = session.metadata?.machineId?.trim() || null
    if (machineId && labelsById[machineId]) {
        return labelsById[machineId]
    }
    const host = session.metadata?.host?.trim()
    if (host) {
        return host
    }
    if (machineId) {
        return machineId.slice(0, 8)
    }
    return null
}

/** Solid amber folder slab — files panel toggle. */
function FilesIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 16 16"
            fill="#E3B341"
            className={props.className ?? 'h-[20px] w-[20px]'}
        >
            <path d="M2 3.2C2 2.5 2.5 2 3.2 2H5.7C6 2 6.3 2.1 6.5 2.4L7.7 3.8C7.9 4.1 8.2 4.2 8.5 4.2H12.8C13.5 4.2 14 4.7 14 5.4V11.8C14 12.5 13.5 13 12.8 13H3.2C2.5 13 2 12.5 2 11.8V3.2Z" />
        </svg>
    )
}

/** Solid violet blocks — outline panel toggle. */
function OutlineIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 16 16"
            fill="#BC8CFF"
            className={props.className ?? 'h-[20px] w-[20px]'}
        >
            <rect x="1.5" y="2" width="13" height="4.6" rx="1" />
            <rect x="1.5" y="7.8" width="5.6" height="6.2" rx="1" />
            <rect x="8.9" y="7.8" width="5.6" height="6.2" rx="1" />
        </svg>
    )
}

function headerToggleClass(active: boolean): string {
    return `flex h-8 w-8 items-center justify-center rounded-full transition-colors ${
        active
            ? 'bg-[var(--app-button)] text-[var(--app-button-text)] hover:opacity-90'
            : 'text-[var(--app-hint)] hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]'
    }`
}

/** Command mark (lucide), green — agent terminal toggle. */
function TerminalIcon(props: { className?: string }) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#3FB950" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className={props.className ?? 'h-[20px] w-[20px]'}>
            <path d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3" />
        </svg>
    )
}

function MoreVerticalIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="currentColor"
            className={props.className}
        >
            <circle cx="12" cy="5" r="2" />
            <circle cx="12" cy="12" r="2" />
            <circle cx="12" cy="19" r="2" />
        </svg>
    )
}

function ModelChangingStatus() {
    const { t } = useTranslation()
    return (
        <span data-testid="session-header-model-changing" className="inline-flex items-center gap-1" title={t('session.modelChange.pendingTooltip')}>
            <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 animate-spin rounded-full border border-current border-r-transparent" />
            <span>{t('session.modelChange.pending')}</span>
        </span>
    )
}

export function SessionHeader(props: {
    session: Session
    serviceTier?: string | null
    onBack: () => void
    onToggleFiles?: () => void
    filesActive?: boolean
    onToggleOutline?: () => void
    outlineActive?: boolean
    onToggleTerminal?: () => void
    terminalActive?: boolean
    api: ApiClient | null
    titleSuggestionAvailable?: boolean
    canReopen?: boolean
    reopenDisabledReason?: string
    reopenHint?: string
    onSessionDeleted?: () => void
    onSessionReopened?: (newSessionId: string) => void | Promise<void>
}) {
    const { t, locale } = useTranslation()
    const navigate = useNavigate()
    const { isTouch } = usePlatform()
    const queryClient = useQueryClient()
    const { addToast } = useToast()
    const { session, api, onSessionDeleted, onSessionReopened } = props
    const title = useMemo(() => getSessionTitle(session), [session])
    // On mobile, give a long title the top row and share the second row
    // between the summary and actions. Measure natural text/button widths
    // so switching rows cannot feed back into the fit calculation.
    const mobileRowRef = useRef<HTMLDivElement | null>(null)
    const mobileTitleRef = useRef<HTMLButtonElement | null>(null)
    const mobileBackRef = useRef<HTMLButtonElement | null>(null)
    const mobileButtonsRef = useRef<HTMLDivElement | null>(null)
    const [actionsWrapped, setActionsWrapped] = useState(false)
    useEffect(() => {
        const rowEl = mobileRowRef.current
        const titleEl = mobileTitleRef.current
        const backEl = mobileBackRef.current
        const buttonsEl = mobileButtonsRef.current
        if (!rowEl || !titleEl || !backEl || !buttonsEl) return
        const update = () => {
            if (window.matchMedia('(min-width: 640px)').matches) {
                setActionsWrapped(false)
                return
            }
            // Without layout information (tests) fall back to the short
            // title layout instead of assuming a wrap. The title text
            // width comes from a Range over its contents: the button
            // itself is flex-1, so its box tracks the layout the state
            // controls and would feed the measurement back into itself.
            const rowWidth = rowEl.clientWidth
            if (rowWidth <= 0) {
                setActionsWrapped(false)
                return
            }
            const range = document.createRange()
            range.selectNodeContents(titleEl)
            const titleWidth = range.getBoundingClientRect().width
            const gap = Number.parseFloat(getComputedStyle(rowEl).columnGap) || 0
            setActionsWrapped(
                backEl.offsetWidth + gap + titleWidth + gap + buttonsEl.scrollWidth > rowWidth + 1
            )
        }
        update()
        if (typeof ResizeObserver === 'undefined') return
        const observer = new ResizeObserver(update)
        observer.observe(rowEl)
        observer.observe(titleEl)
        observer.observe(buttonsEl)
        return () => observer.disconnect()
    }, [title])
    const worktreeBranch = session.metadata?.worktree?.branch?.trim() || null
    const { preferences: headerMetadata } = useSessionHeaderMetadata()
    const gitBranchScope = `${session.metadata?.machineId ?? session.id}:${session.metadata?.path ?? session.id}`
    const liveGitBranch = useSessionGitBranch(api, session.id, session.active, Boolean(api), gitBranchScope)
    const createMergeRequestUrl = useSessionGitLabCreateMergeRequestUrl(
        api,
        session.id,
        session.active,
        Boolean(api),
        gitBranchScope
    )
    const gitBranch = session.active
        ? liveGitBranch ?? worktreeBranch
        : worktreeBranch ?? liveGitBranch
    const externalReviewUrl = useSessionGitLabMergeRequestUrl(api, session.id, session.active, Boolean(api), gitBranchScope)
    const codeOpenUrl = useMemo(() => {
        if (!session.metadata?.path) return null
        const baseUrl = (import.meta.env.VITE_CODE_SERVER_URL || 'https://code.local').replace(/\/+$/, '')
        return buildExternalEditorFolderUrl(baseUrl, session.metadata.path)
    }, [session.metadata?.path])
    const modelLabel = useSessionModelLabel({ session, api })
    const isModelChanging = useIsMutating({
        mutationKey: sessionModelMutationKey(session.id),
        exact: true,
    }) > 0
    const agentFlavor = session.metadata?.flavor ?? null
    const agentLabel = agentFlavor?.trim() || null
    const reasoningEffort = getReasoningEffortForFlavor(
        agentFlavor,
        session.modelReasoningEffort,
        session.effort
    )
    const reasoningLabel = reasoningEffort
        ? formatReasoningLabel(reasoningEffort, headerMetadata.showLabels)
        : null
    // Match expected Fast badge semantics (#1004): only explicit service tier, no effort/model heuristics.
    // Cursor composer fast variants surface the same badge from the model id.
    const isCursorFastModel = agentFlavor === 'cursor' && /fast/i.test(session.model ?? '')
    const showFastBadge = (agentFlavor === 'codex' && isFastServiceTier(props.serviceTier ?? session.serviceTier)) || isCursorFastModel
    const createdAtLabel = headerMetadata.createdAt ? formatSessionHeaderTimestamp(session.createdAt, locale) : null
    const updatedAtLabel = headerMetadata.updatedAt ? formatSessionHeaderTimestamp(session.updatedAt, locale) : null
    const codexSessionId = session.metadata?.flavor === 'codex'
        ? session.metadata.codexSessionId?.trim() || null
        : null
    const piSessionId = session.metadata?.flavor === 'pi'
        ? session.metadata.piSessionId?.trim() || null
        : null
    const { machines } = useMachines(api, Boolean(api))
    const machineLabelsById = useMachineLabels(machines)
    const machineLabel = useMemo(
        () => resolveSessionHeaderMachineLabel(session, machineLabelsById),
        [session, machineLabelsById]
    )
    const projectDirectory = session.metadata?.worktree?.basePath?.trim()
        || session.metadata?.path?.trim()
        || null
    const projectLabel = projectDirectory ? basename(projectDirectory) : null
    const projectHue = projectDirectory ? getProjectLabelHue(projectDirectory) : null
    const modelChip = modelLabel
        ? modelChipText({
            name: modelLabel.value,
            wireId: session.model,
            flavor: agentFlavor,
            modelReasoningEffort: session.modelReasoningEffort,
            effort: session.effort,
            fast: showFastBadge,
        })
        : null
    const showMobileModel = headerMetadata.model && modelChip !== null
    const mobileSecondary = selectMobileSessionHeaderSecondary({
        reasoning: headerMetadata.reasoning && reasoningLabel !== null,
        branch: headerMetadata.branch && gitBranch !== null,
        machine: headerMetadata.machine && machineLabel !== null,
        lastActive: false,
        updatedAt: updatedAtLabel !== null,
        createdAt: createdAtLabel !== null,
        worktree: headerMetadata.worktree && Boolean(worktreeBranch),
        fastMode: headerMetadata.fastMode && showFastBadge,
    })
    const mobileSecondaryValue = mobileSecondary === 'reasoning' ? reasoningLabel
        : mobileSecondary === 'branch' ? gitBranch
        : mobileSecondary === 'machine' ? machineLabel
        : mobileSecondary === 'updatedAt' ? updatedAtLabel
        : mobileSecondary === 'createdAt' ? createdAtLabel
        : mobileSecondary === 'worktree' ? worktreeBranch
        : mobileSecondary === 'fastMode' ? 'fast'
        : null
    const mobileModelChip = modelChip?.startsWith('Muse Spark ')
        ? modelChip.replace(/\s+Contributor\b/, '')
        : modelChip
    const mobileSummary = showMobileModel ? mobileModelChip : mobileSecondaryValue

    const [menuOpen, setMenuOpen] = useState(false)
    const [detailsOpen, setDetailsOpen] = useState(false)
    const [menuAnchorPoint, setMenuAnchorPoint] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
    const menuId = useId()
    const menuAnchorRef = useRef<HTMLButtonElement | null>(null)
    const [renameOpen, setRenameOpen] = useState(false)
    const [exportOpen, setExportOpen] = useState(false)
    const [archiveOpen, setArchiveOpen] = useState(false)
    const [parkOpen, setParkOpen] = useState(false)
    const [restartOpen, setRestartOpen] = useState(false)
    const [deleteOpen, setDeleteOpen] = useState(false)
    const [isSyncingCodex, setIsSyncingCodex] = useState(false)
    const [isSyncingPi, setIsSyncingPi] = useState(false)
    const [isRegeneratingTitle, setIsRegeneratingTitle] = useState(false)
    const hubContextSync = useSessionContextHubSync()
    const { setSessionContextOverride, contextOptions } = useSessionContextFilter(hubContextSync)

    const { archiveSession, parkSession, reopenSession, restartSession, renameSession, suggestSessionTitle, updateSessionSummary, setPinMode, deleteSession, isPending } = useSessionActions(
        api,
        session.id,
        session.metadata?.flavor ?? null
    )
    const [reopenError, setReopenError] = useState<string | null>(null)

    const handleSetPinMode = async (mode: 'none' | 'project' | 'global') => {
        try {
            await setPinMode(mode)
        } catch (error) {
            addToast({
                title: t('session.action.pinFailed'),
                body: error instanceof Error ? error.message : t('dialog.error.default'),
                sessionId: session.id,
                url: `/sessions/${session.id}`
            })
        }
    }

    const handleRegenerateTitle = async () => {
        if (!api || isRegeneratingTitle) return
        setIsRegeneratingTitle(true)
        try {
            await api.regenerateSessionTitle(session.id)
            addToast({
                title: t('session.action.regenerateTitleQueued'),
                body: t('session.action.regenerateTitleQueuedBody'),
                sessionId: session.id,
                url: `/sessions/${session.id}`
            })
        } catch (error) {
            addToast({
                title: t('session.action.regenerateTitleFailed'),
                body: error instanceof Error ? error.message : t('dialog.error.default'),
                sessionId: session.id,
                url: `/sessions/${session.id}`
            })
        } finally {
            setIsRegeneratingTitle(false)
        }
    }
    // tiann/hapi#893: surface the scratchlist entry count in the
    // delete-confirm copy so the operator knows what cascades when they
    // confirm. Read-only hook reuses the cache filled by SessionChat -
    // no extra network when both components are mounted.
    const scratchlistCount = useScratchlistCount(session.id, api)

    const handleDelete = async () => {
        await deleteSession(session.active)
        onSessionDeleted?.()
    }

    const followReopenedSession = async (result: Awaited<ReturnType<typeof reopenSession>>) => {
        if (result.sessionId && result.sessionId !== session.id) {
            retargetSharePendingTransfer(session.id, result.sessionId)
            await onSessionReopened?.(result.sessionId)
        }
    }

    const handleReopen = async () => {
        setReopenError(null)
        try {
            await followReopenedSession(await reopenSession())
        } catch (error) {
            setReopenError(formatReopenError(error))
        }
    }

    const handleRestart = async () => {
        await followReopenedSession(await restartSession())
    }

    const handleSyncCodex = async () => {
        if (!api || !codexSessionId || isSyncingCodex || session.active) return

        setIsSyncingCodex(true)
        try {
            // 中文注释：手动同步必须携带当前会话归属机器和目录；多台 runner 在线时后端不能靠猜。
            const result = await api.syncCodexSession({
                sessionIds: [codexSessionId],
                cwd: typeof session.metadata?.path === 'string' ? session.metadata.path : undefined,
                machineId: typeof session.metadata?.machineId === 'string' ? session.metadata.machineId : undefined
            })
            if (!result.success) {
                throw new Error(result.error || t('codexSync.failed.body'))
            }

            markCodexSessionsImported([codexSessionId])
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: queryKeys.session(session.id) }),
                queryClient.invalidateQueries({ queryKey: queryKeys.messages(session.id) }),
                queryClient.invalidateQueries({ queryKey: queryKeys.sessions })
            ])
            addToast({
                title: t('codexSync.manual.success.title'),
                body: (result.syncedCount ?? 1) === 0
                    ? t('codexSync.manual.success.noNewMessages')
                    : t('codexSync.manual.success.body', { n: result.syncedCount ?? 1 }),
                sessionId: session.id,
                url: `/sessions/${session.id}`
            })
        } catch (error) {
            addToast({
                title: t('codexSync.manual.failed.title'),
                body: error instanceof Error ? error.message : t('codexSync.failed.body'),
                sessionId: session.id,
                url: `/sessions/${session.id}`
            })
        } finally {
            setIsSyncingCodex(false)
        }
    }

    const handleSyncPi = async () => {
        if (!api || !piSessionId || session.active || isSyncingPi) return

        setIsSyncingPi(true)
        try {
            const result = await api.importPiSessions({
                sessionIds: [piSessionId],
                cwd: typeof session.metadata?.path === 'string' ? session.metadata.path : undefined,
                machineId: typeof session.metadata?.machineId === 'string' ? session.metadata.machineId : undefined
            })
            const imported = result.results.find((item) => item.piSessionId === piSessionId)
            if (imported?.error) {
                const message = imported.error.code === 'transcript_diverged'
                    ? t('piImport.error.diverged')
                    : imported.error.code === 'session_active'
                        ? t('piImport.error.active')
                        : imported.error.message
                throw new Error(message)
            }
            if (!imported) throw new Error(result.error || t('piImport.failed.body'))

            await Promise.all([
                queryClient.invalidateQueries({ queryKey: queryKeys.session(session.id) }),
                queryClient.invalidateQueries({ queryKey: queryKeys.messages(session.id) }),
                queryClient.invalidateQueries({ queryKey: queryKeys.sessions })
            ])
            addToast({
                title: t('piImport.manual.success.title'),
                body: (imported.appended ?? 0) === 0
                    ? t('piImport.manual.success.noNewMessages')
                    : t('piImport.manual.success.body', { n: imported.appended ?? 0 }),
                sessionId: session.id,
                url: `/sessions/${session.id}`
            })
        } catch (error) {
            addToast({
                title: t('piImport.manual.failed.title'),
                body: error instanceof Error ? error.message : t('piImport.failed.body'),
                sessionId: session.id,
                url: `/sessions/${session.id}`
            })
        } finally {
            setIsSyncingPi(false)
        }
    }

    const handleMenuToggle = () => {
        if (!menuOpen && menuAnchorRef.current) {
            const rect = menuAnchorRef.current.getBoundingClientRect()
            setMenuAnchorPoint({ x: rect.left + rect.width / 2, y: rect.bottom })
        }
        setMenuOpen((open) => !open)
    }

    // The summary stays in the text column, either inside the title group
    // or in its own grid cell beside the actions on the second row.
    const renderMobileSummary = (layout: 'under-title' | 'inline') => (mobileSummary ? (
        <button
            type="button"
            data-testid="session-header-mobile-summary"
            className={`flex min-w-0 items-center gap-1 overflow-hidden rounded text-left text-xs text-[var(--app-hint)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--app-link)] sm:hidden ${layout === 'under-title' ? 'w-full' : 'col-start-2 row-start-2'}`}
            aria-haspopup="dialog"
            onClick={() => setDetailsOpen(true)}
        >
            {headerMetadata.agent && agentLabel ? <AgentFlavorIcon flavor={session.metadata?.flavor} className="h-3.5 w-3.5 shrink-0 -translate-y-px" /> : null}
            <span data-testid={showMobileModel ? 'session-header-mobile-model' : undefined} className="truncate">{mobileSummary}</span>
            {showMobileModel && isModelChanging ? <ModelChangingStatus /> : null}
        </button>
    ) : null)

    // In Telegram, don't render header (Telegram provides its own)
    if (isTelegramApp()) {
        return null
    }

    return (
        <>
            <div className="bg-[var(--app-bg)] pt-[env(safe-area-inset-top)]">
                <div className="mx-auto w-full max-w-content p-3">
                <div ref={mobileRowRef} className="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-x-2">
                    {/* Back button */}
                    <button
                        type="button"
                        ref={mobileBackRef}
                        onClick={props.onBack}
                        className="col-start-1 row-start-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]"
                    >
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="20"
                            height="20"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        >
                            <polyline points="15 18 9 12 15 6" />
                        </svg>
                    </button>

                    <div data-testid="session-header-title-group" className={`col-start-2 row-start-1 min-w-0 ${actionsWrapped ? 'col-span-2 sm:col-span-1' : ''}`}>
                    <button
                        type="button"
                        ref={mobileTitleRef}
                        data-testid="session-header-mobile-details"
                        className="block w-full min-w-0 truncate rounded text-left font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--app-link)] sm:hidden"
                        aria-haspopup="dialog"
                        onClick={() => setDetailsOpen(true)}
                    >
                        {title}
                    </button>
                    <div className="hidden min-w-0 flex-1 sm:block">
                        <div className="truncate font-semibold">{title}</div>
                        <div className="hidden flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-[var(--app-hint)] sm:flex">
                            {projectLabel && projectHue !== null ? (
                                <span
                                    data-testid="session-header-project"
                                    className="inline-flex max-w-[12rem] items-center truncate rounded-[5px] border border-[var(--session-project-border)] bg-[var(--session-project-bg)] px-1.5 py-px font-medium leading-tight text-[var(--session-project-fg)]"
                                    style={{
                                        '--session-project-fg': `light-dark(hsl(${projectHue} 78% 27%), hsl(${projectHue} 95% 88%))`,
                                        '--session-project-bg': `light-dark(hsl(${projectHue} 92% 89%), hsl(${projectHue} 68% 30%))`,
                                        '--session-project-border': `light-dark(hsl(${projectHue} 70% 72%), hsl(${projectHue} 68% 45%))`,
                                    } as CSSProperties}
                                    title={projectDirectory ?? projectLabel}
                                >
                                    {projectLabel}
                                </span>
                            ) : null}
                            {headerMetadata.model && modelChip ? (
                                <span data-testid="session-header-model" className="inline-flex items-center gap-1.5">
                                    <AgentFlavorIcon flavor={agentFlavor} className="h-3.5 w-3.5 shrink-0" />
                                    <span>{modelChip}</span>
                                    {isModelChanging ? <ModelChangingStatus /> : null}
                                </span>
                            ) : headerMetadata.agent && agentLabel ? (
                                <AgentFlavorIcon flavor={session.metadata?.flavor} className="h-3.5 w-3.5 shrink-0" />
                            ) : null}
                            {headerMetadata.branch && gitBranch ? (
                                <span data-testid="session-header-branch" className="inline-flex max-w-[18rem] items-center gap-1" title={gitBranch}>
                                    <GitBranchIcon />
                                    <span className="truncate">{gitBranch}</span>
                                </span>
                            ) : null}
                            {headerMetadata.machine && machineLabel ? (
                                <span data-testid="session-header-machine" className="max-w-[12rem] truncate" title={machineLabel}>
                                    {headerMetadata.showLabels ? `${t('session.item.machine')}: ` : ''}{machineLabel}
                                </span>
                            ) : null}
                            {headerMetadata.reasoning && reasoningLabel && !modelChip ? (
                                <span data-testid="session-header-reasoning">
                                    {reasoningLabel}
                                </span>
                            ) : null}
                            {headerMetadata.fastMode && showFastBadge && !modelChip ? (
                                <span data-testid="session-header-fast" className="text-[#34C759]">
                                    fast
                                </span>
                            ) : null}
                            {createdAtLabel ? <span>{headerMetadata.showLabels ? `${t('session.header.createdAt')}: ` : ''}{createdAtLabel}</span> : null}
                            {updatedAtLabel ? <span>{headerMetadata.showLabels ? `${t('session.header.updatedAt')}: ` : ''}{updatedAtLabel}</span> : null}
                            {headerMetadata.worktree && worktreeBranch ? (
                                <span>{headerMetadata.showLabels ? `${t('session.item.worktree')}: ` : ''}{worktreeBranch}</span>
                            ) : null}
                        </div>
                    </div>

                    {!actionsWrapped ? renderMobileSummary('under-title') : null}
                    </div>

                    {actionsWrapped ? renderMobileSummary('inline') : null}
                    <div ref={mobileButtonsRef} data-testid="session-header-mobile-actions" className={`col-start-3 flex items-center gap-2 ${actionsWrapped ? 'row-start-2 sm:row-start-1' : 'row-start-1'}`}>
                        {props.onToggleFiles ? (
                            <button
                                type="button"
                                onClick={props.onToggleFiles}
                                className={headerToggleClass(props.filesActive ?? false)}
                                title={props.filesActive ? t('session.view.returnToChat') : t('session.title')}
                                aria-label={props.filesActive ? t('session.view.returnToChat') : t('session.title')}
                                aria-pressed={props.filesActive ?? false}
                            >
                                <FilesIcon />
                            </button>
                        ) : null}

                        {props.onToggleOutline ? (
                            <button
                                type="button"
                                onClick={props.onToggleOutline}
                                className={headerToggleClass(props.outlineActive ?? false)}
                                title={props.outlineActive ? t('session.outline.close') : t('session.outline.open')}
                                aria-label={props.outlineActive ? t('session.outline.close') : t('session.outline.open')}
                                aria-pressed={props.outlineActive ?? false}
                            >
                                <OutlineIcon />
                            </button>
                        ) : null}

                        {props.onToggleTerminal ? (
                            <button
                                type="button"
                                onClick={props.onToggleTerminal}
                                className={headerToggleClass(props.terminalActive ?? false)}
                                title="Terminal"
                                aria-label="Terminal"
                                aria-pressed={props.terminalActive ?? false}
                            >
                                <TerminalIcon />
                            </button>
                        ) : null}

                        {!isTouch && externalReviewUrl ? (
                            <a
                                href={externalReviewUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className={headerToggleClass(false)}
                                title={t('session.action.openExternalReview')}
                                aria-label={t('session.action.openExternalReview')}
                                data-testid="session-header-open-external-review"
                            >
                                <GitLabIcon className="h-[20px] w-[20px]" />
                            </a>
                        ) : null}

                        {codeOpenUrl ? (
                            <a
                                href={codeOpenUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className={`${headerToggleClass(false)} max-sm:hidden`}
                                title={t('session.action.openCode')}
                                aria-label={t('session.action.openCode')}
                                data-testid="session-header-open-code"
                            >
                                <CodeIcon className="h-[20px] w-[20px]" />
                            </a>
                        ) : null}

                        <button
                            type="button"
                            onClick={handleMenuToggle}
                            onPointerDown={(e) => e.stopPropagation()}
                            ref={menuAnchorRef}
                            aria-haspopup="menu"
                            aria-expanded={menuOpen}
                            aria-controls={menuOpen ? menuId : undefined}
                            className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]"
                            title={t('session.more')}
                        >
                            <MoreVerticalIcon />
                        </button>
                    </div>
                </div>
                </div>
            </div>

            <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle className="break-words leading-snug">{title}</DialogTitle>
                    </DialogHeader>
                    <dl className="mt-4 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
                        {agentLabel ? <><dt className="text-[var(--app-hint)]">{t('session.item.agent')}</dt><dd className="min-w-0 break-all">{agentLabel}</dd></> : null}
                        {modelLabel ? <><dt className="text-[var(--app-hint)]">{t('session.item.model')}</dt><dd className="min-w-0 break-all">{prettyModelName(modelLabel.value)}</dd></> : null}
                        {gitBranch ? <><dt className="text-[var(--app-hint)]">{t('session.item.branch')}</dt><dd className="min-w-0 break-all select-text">{gitBranch}</dd></> : null}
                        {reasoningEffort ? <><dt className="text-[var(--app-hint)]">{t('settings.display.sessionHeader.reasoning')}</dt><dd className="min-w-0 break-all">{formatCodexReasoningEffortLabel(reasoningEffort)}</dd></> : null}
                        {machineLabel ? <><dt className="text-[var(--app-hint)]">{t('session.item.machine')}</dt><dd className="min-w-0 break-all">{machineLabel}</dd></> : null}
                        {session.metadata?.path ? <><dt className="text-[var(--app-hint)]">{t('session.item.path')}</dt><dd className="min-w-0 break-all select-text">{session.metadata.path}</dd></> : null}
                    </dl>
                </DialogContent>
            </Dialog>

            <SessionActionMenu
                isOpen={menuOpen}
                onClose={() => setMenuOpen(false)}
                sessionId={session.id}
                sessionTitle={title}
                sessionActive={session.active}
                sessionPinned={Boolean(session.pinned)}
                sessionGlobalPinned={Boolean(session.globalPinned)}
                currentContext={resolveSessionContext(session, contextOptions)}
                onSetContext={(ctx) => setSessionContextOverride(session.id, ctx)}
                onRename={() => setRenameOpen(true)}
                onRegenerateTitle={api && session.active && agentFlavor === 'codex' && !isRegeneratingTitle
                    ? () => void handleRegenerateTitle()
                    : undefined}
                onMarkUnread={() => markSessionUnread(session.id, session.lastAgentMessageAt ?? 0)}
                onSetPinMode={api ? (mode) => void handleSetPinMode(mode) : undefined}
                onExport={() => setExportOpen(true)}
                onSyncCodex={api && codexSessionId && !session.active ? handleSyncCodex : undefined}
                onSyncPi={api && piSessionId && !session.active ? handleSyncPi : undefined}
                externalReviewUrl={externalReviewUrl}
                codeOpenUrl={codeOpenUrl}
                createExternalReviewUrl={!externalReviewUrl ? createMergeRequestUrl : null}
                onContinueInFolder={() => navigate({
                    to: '/browse',
                    search: {
                        continueFromSessionId: session.id,
                        ...(session.metadata?.machineId ? { machineId: session.metadata.machineId } : {}),
                    },
                })}
                onRestart={props.canReopen === false ? undefined : () => setRestartOpen(true)}
                onPark={session.active && props.canReopen !== false ? () => setParkOpen(true) : undefined}
                onArchive={() => setArchiveOpen(true)}
                onReopen={props.canReopen === false ? undefined : handleReopen}
                reopenDisabledReason={props.reopenDisabledReason}
                reopenHint={props.reopenHint}
                onDelete={() => setDeleteOpen(true)}
                anchorPoint={menuAnchorPoint}
                menuId={menuId}
            />

            {reopenError ? (
                <ConfirmDialog
                    isOpen={true}
                    onClose={() => setReopenError(null)}
                    title={t('dialog.reopen.errorTitle')}
                    description={reopenError}
                    confirmLabel={t('dialog.reopen.dismiss')}
                    confirmingLabel={t('dialog.reopen.dismiss')}
                    onConfirm={async () => setReopenError(null)}
                    isPending={false}
                    centerTitle
                />
            ) : null}

            <RenameSessionDialog
                isOpen={renameOpen}
                onClose={() => setRenameOpen(false)}
                currentName={title}
                onRename={renameSession}
                onSuggestTitle={api && props.titleSuggestionAvailable ? suggestSessionTitle : undefined}
                onUpdateSummary={api && props.titleSuggestionAvailable ? updateSessionSummary : undefined}
                isPending={isPending}
            />

            <SessionExportDialog
                isOpen={exportOpen}
                onClose={() => setExportOpen(false)}
                sessionId={session.id}
                api={api}
            />

            <ConfirmDialog
                isOpen={archiveOpen}
                onClose={() => setArchiveOpen(false)}
                title={t('dialog.archive.title')}
                description={t('dialog.archive.description', { name: title })}
                confirmLabel={t('dialog.archive.confirm')}
                confirmingLabel={t('dialog.archive.confirming')}
                onConfirm={archiveSession}
                isPending={isPending}
                destructive
                centerTitle
            />

            <ConfirmDialog
                isOpen={parkOpen}
                onClose={() => setParkOpen(false)}
                title={t('dialog.park.title')}
                description={t('dialog.park.description', { name: title })}
                confirmLabel={t('dialog.park.confirm')}
                confirmingLabel={t('dialog.park.confirming')}
                onConfirm={parkSession}
                isPending={isPending}
                centerTitle
            />

            <ConfirmDialog
                isOpen={restartOpen}
                onClose={() => setRestartOpen(false)}
                title={t('dialog.restart.title')}
                description={t('dialog.restart.description', { name: title })}
                confirmLabel={t('dialog.restart.confirm')}
                confirmingLabel={t('dialog.restart.confirming')}
                onConfirm={handleRestart}
                isPending={isPending}
                centerTitle
            />

            <ConfirmDialog
                isOpen={deleteOpen}
                onClose={() => setDeleteOpen(false)}
                title={t('dialog.delete.title')}
                description={
                    scratchlistCount > 0
                        ? `${t('dialog.delete.description', { name: title })} ${t(
                            scratchlistCount === 1
                                ? 'dialog.delete.scratchlist.one'
                                : 'dialog.delete.scratchlist.other',
                            { n: String(scratchlistCount) }
                        )}`
                        : t('dialog.delete.description', { name: title })
                }
                confirmLabel={t('dialog.delete.confirm')}
                confirmingLabel={t('dialog.delete.confirming')}
                onConfirm={handleDelete}
                isPending={isPending}
                destructive
                centerTitle
            />
        </>
    )
}
