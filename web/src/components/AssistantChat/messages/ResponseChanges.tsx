import { useState } from 'react'
import type { ApiClient } from '@/api/client'
import type { WorkspaceChanges } from '@hapi/protocol'
import { UnifiedDiffDisplay } from '@/components/UnifiedDiffDisplay'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useWorkspaceTurnChanges } from '@/hooks/queries/useWorkspaceTurnChanges'
import { useTranslation } from '@/lib/use-translation'
import { cn } from '@/lib/utils'

function ChangesIcon({ className }: { className?: string }) {
    return (
        <svg
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={className}
            aria-hidden="true"
        >
            <path d="M6 4v12M14 4v12M3.5 7H8.5M11.5 13h5" />
        </svg>
    )
}

export function ResponseChanges({ changes, api, sessionId }: { changes: WorkspaceChanges; api?: ApiClient; sessionId?: string }) {
    const { t } = useTranslation()
    const [open, setOpen] = useState(false)

    // Periodic in-turn stats arrive without the diff text; the dialog fetches
    // the turn-scoped diff on demand and keeps refreshing while the turn runs.
    const fetchOnOpen = changes.pending === true && Boolean(api && sessionId)
    const turnChangesQuery = useWorkspaceTurnChanges({
        api,
        sessionId,
        enabled: open && fetchOnOpen
    })
    const fetchedChanges = turnChangesQuery.data?.success === true ? turnChangesQuery.data.changes : null
    // Header stats prefer the fetched numbers (same tick as the shown diff);
    // the prop counts fill in while the fetch is in flight.
    const headerChanges = fetchOnOpen && fetchedChanges ? fetchedChanges : changes

    return (
        <>
            <button
                type="button"
                onClick={() => setOpen(true)}
                aria-haspopup="dialog"
                aria-label={t('session.responseChanges.open')}
                className={cn(
                    'inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs font-medium',
                    'text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)]',
                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)]'
                )}
            >
                <ChangesIcon className="h-4 w-4" />
                <span>{t('session.responseChanges.open')}</span>
                <span aria-hidden="true" className="hidden tabular-nums opacity-70 sm:inline">· {changes.filesChanged}</span>
                <span className="tabular-nums text-[var(--app-git-staged-color)]">+{changes.additions}</span>
                <span className="tabular-nums text-[var(--app-git-deleted-color)]">−{changes.deletions}</span>
            </button>

            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent aria-describedby={undefined} className="flex max-h-[calc(100dvh-24px)] max-w-5xl flex-col overflow-hidden p-0 sm:max-h-[88vh]">
                    <DialogHeader className="shrink-0 border-b border-[var(--app-divider)] px-4 py-4 pr-14 text-left">
                        <DialogTitle>{t('session.responseChanges.title')}</DialogTitle>
                        <div className="flex gap-3 text-xs text-[var(--app-hint)]">
                            <span>{t('session.responseChanges.files', { n: headerChanges.filesChanged })}</span>
                            <span className="text-[var(--app-git-staged-color)]">+{headerChanges.additions}</span>
                            <span className="text-[var(--app-git-deleted-color)]">−{headerChanges.deletions}</span>
                        </div>
                    </DialogHeader>
                    <div data-hapi-nested-scroll="true" className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 sm:p-4">
                        {fetchOnOpen ? (
                            turnChangesQuery.isLoading ? (
                                <div className="flex items-center gap-2 rounded-lg bg-[var(--app-subtle-bg)] p-4 text-sm text-[var(--app-hint)]">
                                    <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" />
                                    {t('session.responseChanges.loading')}
                                </div>
                            ) : turnChangesQuery.data?.success === true ? (
                                turnChangesQuery.data.changes === null
                                    ? <div className="rounded-lg bg-[var(--app-subtle-bg)] p-4 text-sm text-[var(--app-hint)]">
                                        {t('session.responseChanges.unavailable')}
                                    </div>
                                    : turnChangesQuery.data.changes.diff === null
                                        ? <div className="rounded-lg bg-[var(--app-subtle-bg)] p-4 text-sm text-[var(--app-hint)]">
                                            {t('session.responseChanges.tooLarge')}
                                        </div>
                                        : <UnifiedDiffDisplay diffContent={turnChangesQuery.data.changes.diff} showToolbar />
                            ) : (
                                <div className="rounded-lg bg-[var(--app-subtle-bg)] p-4 text-sm text-[var(--app-hint)]">
                                    {t('session.responseChanges.fetchFailed')}
                                </div>
                            )
                        ) : changes.diff !== null
                            ? <UnifiedDiffDisplay diffContent={changes.diff} showToolbar />
                            : <div className="rounded-lg bg-[var(--app-subtle-bg)] p-4 text-sm text-[var(--app-hint)]">
                                {t('session.responseChanges.tooLarge')}
                            </div>}
                    </div>
                </DialogContent>
            </Dialog>
        </>
    )
}
