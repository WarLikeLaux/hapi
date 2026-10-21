import { isSessionBusy } from '@hapi/protocol'
import { useRef, useState, type ReactNode } from 'react'
import type { ApiClient } from '@/api/client'
import type { SessionSummary } from '@/types/api'
import type { SessionContextId } from '@/lib/sessionContexts'
import { useTranslation } from '@/lib/use-translation'
import { useToast } from '@/lib/toast-context'
import { usePlatform } from '@/hooks/usePlatform'
import { useLongPress } from '@/hooks/useLongPress'
import { useCursorChatStoreStatus } from '@/hooks/queries/useCursorChatStoreStatus'
import { resolveCursorReopenGate } from '@/lib/sessionResume'
import { useSessionActions } from '@/hooks/mutations/useSessionActions'
import { retargetSharePendingTransfer } from '@/lib/sharePendingState'
import { transferComposerDraftThenNavigate } from '@/lib/composer-draft-transfer'
import { formatReopenError } from '@/lib/reopenError'
import { getSessionTitle } from '@/lib/sessionTitle'
import { markSessionUnread } from '@/lib/sessionLastSeen'
import { getSessionUnreadActivityAt } from '@/lib/sessionAttention'
import { SessionActionMenu } from '@/components/SessionActionMenu'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { RenameSessionDialog } from '@/components/RenameSessionDialog'
import { SessionExportDialog } from '@/components/SessionExportDialog'

type TriggerHandlers = ReturnType<typeof useLongPress>

/** Shared action ownership for sidebar previews and group tabs. */
export function SessionItemActions(props: {
    session: SessionSummary
    api: ApiClient | null
    onSelect: (id: string) => void
    interaction?: 'legacy' | 'touch-only-native-click'
    titleSuggestionAvailable?: boolean
    currentContext?: SessionContextId
    onSetContext?: (context: SessionContextId | null) => void
    children: (handlers: TriggerHandlers) => ReactNode
}) {
    const { session: s, api, onSelect, titleSuggestionAvailable = false } = props
    const { t } = useTranslation()
    const { addToast } = useToast()
    const triggerRef = useRef<HTMLButtonElement | null>(null)
    const { haptic } = usePlatform()
    const [menuOpen, setMenuOpen] = useState(false)
    const [menuAnchorPoint, setMenuAnchorPoint] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
    const [renameOpen, setRenameOpen] = useState(false)
    const [exportOpen, setExportOpen] = useState(false)
    const [archiveOpen, setArchiveOpen] = useState(false)
    const [parkOpen, setParkOpen] = useState(false)
    const [restartOpen, setRestartOpen] = useState(false)
    const [deleteOpen, setDeleteOpen] = useState(false)
    const {
        status: cursorChatStoreStatus,
        isApplicable: cursorChatStoreApplicable,
        error: cursorChatStoreError,
        isLoading: cursorChatStoreLoading,
    } = useCursorChatStoreStatus({
        api,
        session: s,
        enabled: menuOpen
    })
    const cursorReopenGate = resolveCursorReopenGate({
        applicable: cursorChatStoreApplicable,
        onDisk: cursorChatStoreStatus?.onDisk,
        error: cursorChatStoreError,
        isLoading: cursorChatStoreLoading,
    })
    const cursorReopenDisabledReason = cursorReopenGate.disabledReason === 'missing'
        ? t('session.action.reopenCursorMissing')
        : cursorReopenGate.disabledReason === 'checking'
            ? t('session.action.reopenCursorChecking')
            : undefined
    const cursorReopenUnverifiedHint = cursorReopenGate.probeUnverified
        ? t('session.action.reopenCursorUnverified')
            : undefined
    const { archiveSession, parkSession, reopenSession, restartSession, renameSession, suggestSessionTitle, updateSessionSummary, deleteSession, setPinMode, isPending } = useSessionActions(
        api,
        s.id,
        s.metadata?.flavor ?? null
    )
    const [reopenError, setReopenError] = useState<string | null>(null)

    const handleSetPinMode = async (mode: 'none' | 'project' | 'global') => {
        try {
            await setPinMode(mode)
        } catch (error) {
            addToast({
                title: t('session.action.pinFailed'),
                body: error instanceof Error ? error.message : t('dialog.error.default'),
                sessionId: s.id,
                url: `/sessions/${s.id}`
            })
        }
    }

    const followReopenedSession = async (result: Awaited<ReturnType<typeof reopenSession>>) => {
        // resumeSession may merge the row into a freshly-spawned sessionId.
        // Follow it so the operator lands on the live session.
        if (result.sessionId && result.sessionId !== s.id) {
            retargetSharePendingTransfer(s.id, result.sessionId)
            await transferComposerDraftThenNavigate(
                s.id,
                result.sessionId,
                () => onSelect(result.sessionId),
            )
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

    const longPressHandlers = useLongPress({
        onLongPress: (point) => {
            haptic.impact('medium')
            setMenuAnchorPoint(point)
            setMenuOpen(true)
        },
        onClick: () => {
            if (!menuOpen) {
                onSelect(s.id)
            }
        },
        interaction: props.interaction,
        threshold: 500
    })

    const sessionName = getSessionTitle(s)
    const closeMenu = () => {
        setMenuOpen(false)
        triggerRef.current?.focus()
    }
    const handlers: TriggerHandlers = {
        ...longPressHandlers,
        onMouseDown: event => {
            triggerRef.current = event.currentTarget as HTMLButtonElement
            longPressHandlers.onMouseDown(event)
        },
        onTouchStart: event => {
            triggerRef.current = event.currentTarget as HTMLButtonElement
            longPressHandlers.onTouchStart(event)
        },
        onContextMenu: event => {
            triggerRef.current = event.currentTarget as HTMLButtonElement
            if (props.interaction === 'touch-only-native-click') {
                event.preventDefault()
                haptic.impact('medium')
                setMenuAnchorPoint({ x: event.clientX, y: event.clientY })
                setMenuOpen(true)
            } else {
                longPressHandlers.onContextMenu(event)
            }
        },
        onKeyDown: event => {
            if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) {
                longPressHandlers.onKeyDown(event)
                return
            }
            event.preventDefault()
            event.stopPropagation()
            triggerRef.current = event.currentTarget as HTMLButtonElement
            const rect = event.currentTarget.getBoundingClientRect()
            setMenuAnchorPoint({ x: rect.left + rect.width / 2, y: rect.bottom })
            setMenuOpen(true)
        },
    }
    return <>
        {props.children(handlers)}
        <SessionActionMenu
            isOpen={menuOpen}
            onClose={closeMenu}
            sessionId={s.id}
            sessionTitle={sessionName}
            sessionActive={s.active}
            sessionLifecycleState={s.metadata?.lifecycleState}
            sessionPinned={Boolean(s.pinned)}
            sessionGlobalPinned={Boolean(s.globalPinned)}
            currentContext={props.currentContext}
            onSetContext={props.onSetContext}
            onSetPinMode={(mode) => void handleSetPinMode(mode)}
            onRename={() => setRenameOpen(true)}
            onExport={() => setExportOpen(true)}
            onMarkUnread={() => markSessionUnread(s.id, getSessionUnreadActivityAt(s))}
            onRestart={cursorReopenDisabledReason ? undefined : () => setRestartOpen(true)}
            parkDisabledReason={isSessionBusy(s) ? t('session.park.busy') : undefined}
            onPark={s.active && !cursorReopenDisabledReason ? () => setParkOpen(true) : undefined}
            onArchive={() => setArchiveOpen(true)}
            onReopen={cursorReopenDisabledReason ? undefined : handleReopen}
            reopenDisabledReason={cursorReopenDisabledReason}
            reopenHint={cursorReopenUnverifiedHint}
            onDelete={() => setDeleteOpen(true)}
            anchorPoint={menuAnchorPoint}
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

        {renameOpen ? (
            <RenameSessionDialog
                isOpen={true}
                onClose={() => setRenameOpen(false)}
                currentName={sessionName}
                onRename={renameSession}
                onSuggestTitle={api && titleSuggestionAvailable ? suggestSessionTitle : undefined}
                onUpdateSummary={api && titleSuggestionAvailable ? updateSessionSummary : undefined}
                isPending={isPending}
            />
        ) : null}

        {exportOpen ? (
            <SessionExportDialog
                isOpen={true}
                onClose={() => setExportOpen(false)}
                sessionId={s.id}
                api={api}
            />
        ) : null}

        {archiveOpen ? (
            <ConfirmDialog
                isOpen={true}
                onClose={() => setArchiveOpen(false)}
                title={t('dialog.archive.title')}
                description={t('dialog.archive.description', { name: sessionName })}
                confirmLabel={t('dialog.archive.confirm')}
                confirmingLabel={t('dialog.archive.confirming')}
                onConfirm={archiveSession}
                isPending={isPending}
                destructive
                centerTitle
            />
        ) : null}

        {parkOpen ? (
            <ConfirmDialog
                isOpen={true}
                onClose={() => setParkOpen(false)}
                title={t('dialog.park.title')}
                description={t('dialog.park.description', { name: sessionName })}
                confirmLabel={t('dialog.park.confirm')}
                confirmingLabel={t('dialog.park.confirming')}
                onConfirm={parkSession}
                isPending={isPending}
                centerTitle
            />
        ) : null}

        {restartOpen ? (
            <ConfirmDialog
                isOpen={true}
                onClose={() => setRestartOpen(false)}
                title={t('dialog.restart.title')}
                description={t('dialog.restart.description', { name: sessionName })}
                confirmLabel={t('dialog.restart.confirm')}
                confirmingLabel={t('dialog.restart.confirming')}
                onConfirm={handleRestart}
                isPending={isPending}
                centerTitle
            />
        ) : null}

        {deleteOpen ? (
            <ConfirmDialog
                isOpen={true}
                onClose={() => setDeleteOpen(false)}
                title={t('dialog.delete.title')}
                description={t('dialog.delete.description', { name: sessionName })}
                confirmLabel={t('dialog.delete.confirm')}
                confirmingLabel={t('dialog.delete.confirming')}
                onConfirm={() => deleteSession(s.active)}
                isPending={isPending}
                destructive
                centerTitle
            />
        ) : null}
    </>
}
