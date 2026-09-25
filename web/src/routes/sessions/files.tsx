import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { PRESERVE_SESSION_SIDEBAR_SCROLL } from '@/lib/sessionNavigation'
import type { FileSearchItem, GitComparisonScope, GitFileStatus } from '@/types/api'
import { FileIcon } from '@/components/FileIcon'
import { DirectoryTree } from '@/components/SessionFiles/DirectoryTree'
import { FileActionMenu } from '@/components/FileActionMenu'
import { useFileMenuTrigger } from '@/hooks/useFileMenuTrigger'
import type { AnchoredMenuPoint } from '@/hooks/useAnchoredMenu'
import { appendFileReferenceToComposerDraft } from '@/lib/file-composer'
import { resolveAbsoluteFilePath } from '@/lib/file-path'
import { SessionHeader } from '@/components/SessionHeader'
import { LoadingState } from '@/components/LoadingState'
import { useAppContext } from '@/lib/app-context'
import { useAppGoBack } from '@/hooks/useAppGoBack'
import { useHorizontalSwipe } from '@/hooks/useHorizontalSwipe'
import { useGitStatusFiles } from '@/hooks/queries/useGitStatusFiles'
import { useGitComparisonFiles } from '@/hooks/queries/useGitComparisonFiles'
import { useSession } from '@/hooks/queries/useSession'
import { useSessionFileSearch } from '@/hooks/queries/useSessionFileSearch'
import {
    formatFileSearchError,
    formatGitStatusError,
    getDetachedBranchLabel,
    getProjectRootLabel,
} from '@/lib/files-i18n'
import { encodeBase64 } from '@/lib/utils'
import { queryKeys } from '@/lib/query-keys'
import { transferComposerDraftThenNavigate } from '@/lib/composer-draft-transfer'
import { formatFileMetadata } from '@/lib/file-metadata'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from '@/lib/use-translation'
import * as Popover from '@radix-ui/react-popover'
import { CheckIcon, CloseIcon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { UnifiedDiffDisplay } from '@/components/UnifiedDiffDisplay'
import {
    DEFAULT_DIRECTORY_SORT,
    type DirectorySort,
    type DirectorySortDirection,
    type DirectorySortField,
    sortFileSearchItems,
} from '@/lib/directory-sort'

function RefreshIcon(props: { className?: string }) {
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
            <path d="M21 12a9 9 0 1 1-3-6.7" />
            <polyline points="21 3 21 9 15 9" />
        </svg>
    )
}

function SortIcon() {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 6h13" /><path d="M3 12h9" /><path d="M3 18h5" />
            <path d="m17 15 3 3 3-3" /><path d="M20 18V6" />
        </svg>
    )
}

const DIRECTORY_SORT_STORAGE_KEY = 'hapi-directory-sort'
const FILES_TAB_STORAGE_KEY = 'hapi-files-tab'

type FilesTab = 'changes' | 'directories'
type ChangesView = 'working' | GitComparisonScope
type ChangesDisplay = 'files' | 'diff'

function readFilesTab(): FilesTab {
    try {
        const value = localStorage.getItem(FILES_TAB_STORAGE_KEY)
        if (value === 'changes' || value === 'directories') {
            return value
        }
    } catch {
        // Use the default when storage is unavailable.
    }
    return 'changes'
}

function persistFilesTab(tab: FilesTab): void {
    try {
        localStorage.setItem(FILES_TAB_STORAGE_KEY, tab)
    } catch {
        // Tab switching still works when storage is unavailable.
    }
}

function readDirectorySort(): DirectorySort {
    try {
        const value = JSON.parse(localStorage.getItem(DIRECTORY_SORT_STORAGE_KEY) ?? '') as Partial<DirectorySort>
        if (['name', 'modified', 'size'].includes(value.field ?? '') && ['asc', 'desc'].includes(value.direction ?? '')) {
            return value as DirectorySort
        }
    } catch {
        // Use the default when storage is unavailable or invalid.
    }
    return DEFAULT_DIRECTORY_SORT
}

function DirectorySortMenu(props: { sort: DirectorySort; onChange: (sort: DirectorySort) => void; embedded?: boolean }) {
    const { t } = useTranslation()
    const fields: Array<{ value: DirectorySortField; label: string }> = [
        { value: 'name', label: t('files.sort.name') },
        { value: 'modified', label: t('files.sort.modified') },
        { value: 'size', label: t('files.sort.size') },
    ]
    const directions: Array<{ value: DirectorySortDirection; label: string }> = props.sort.field === 'name'
        ? [{ value: 'asc', label: t('files.sort.nameAsc') }, { value: 'desc', label: t('files.sort.nameDesc') }]
        : props.sort.field === 'modified'
            ? [{ value: 'asc', label: t('files.sort.oldest') }, { value: 'desc', label: t('files.sort.newest') }]
            : [{ value: 'asc', label: t('files.sort.smallest') }, { value: 'desc', label: t('files.sort.largest') }]
    const optionClass = 'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-[var(--app-subtle-bg)]'

    return (
        <Popover.Root>
            <Popover.Trigger asChild>
                <button
                    type="button"
                    className={props.embedded
                        ? 'flex w-10 shrink-0 self-stretch items-center justify-center rounded-r-md rounded-l-sm text-[var(--app-hint)] transition-colors hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)]'
                        : 'flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[var(--app-hint)] transition-colors hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)]'}
                    title={t('files.sort.title')}
                    aria-label={t('files.sort.title')}
                >
                    <SortIcon />
                </button>
            </Popover.Trigger>
            <Popover.Portal>
                <Popover.Content side="bottom" align="end" sideOffset={6} collisionPadding={8} className="z-50 w-48 rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] p-2 shadow-lg">
                    <div className="px-2 pb-1 text-xs font-semibold text-[var(--app-hint)]">{t('files.sort.by')}</div>
                    {fields.map((field) => (
                        <button key={field.value} type="button" className={optionClass} onClick={() => props.onChange({ field: field.value, direction: props.sort.direction })}>
                            <span className="flex h-4 w-4 items-center justify-center">{props.sort.field === field.value ? <CheckIcon className="h-3.5 w-3.5" /> : null}</span>
                            {field.label}
                        </button>
                    ))}
                    <div className="my-1 border-t border-[var(--app-divider)]" />
                    {directions.map((direction) => (
                        <button key={direction.value} type="button" className={optionClass} onClick={() => props.onChange({ ...props.sort, direction: direction.value })}>
                            <span className="flex h-4 w-4 items-center justify-center">{props.sort.direction === direction.value ? <CheckIcon className="h-3.5 w-3.5" /> : null}</span>
                            {direction.label}
                        </button>
                    ))}
                </Popover.Content>
            </Popover.Portal>
        </Popover.Root>
    )
}

function SearchIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
    )
}

function GitBranchIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <line x1="6" y1="3" x2="6" y2="15" />
            <circle cx="6" cy="18" r="3" />
            <circle cx="18" cy="6" r="3" />
            <path d="M18 9a9 9 0 0 1-9 9" />
        </svg>
    )
}

function FolderIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        </svg>
    )
}

function StatusBadge(props: { status: GitFileStatus['status'] }) {
    const { label, color } = useMemo(() => {
        switch (props.status) {
            case 'added':
                return { label: 'A', color: 'var(--app-git-staged-color)' }
            case 'deleted':
                return { label: 'D', color: 'var(--app-git-deleted-color)' }
            case 'renamed':
                return { label: 'R', color: 'var(--app-git-renamed-color)' }
            case 'untracked':
                return { label: '?', color: 'var(--app-git-untracked-color)' }
            case 'conflicted':
                return { label: 'U', color: 'var(--app-git-deleted-color)' }
            default:
                return { label: 'M', color: 'var(--app-git-unstaged-color)' }
        }
    }, [props.status])

    return (
        <span
            className="inline-flex items-center justify-center rounded border px-1.5 py-0.5 text-[10px] font-semibold"
            style={{ color, borderColor: color }}
        >
            {label}
        </span>
    )
}

function LineChanges(props: { added: number; removed: number }) {
    if (!props.added && !props.removed) return null

    return (
        <span className="flex items-center gap-1 text-[11px] font-mono">
            {props.added ? (
                <span className="text-[var(--app-diff-added-text)]">+{props.added}</span>
            ) : null}
            {props.removed ? (
                <span className="text-[var(--app-diff-removed-text)]">-{props.removed}</span>
            ) : null}
        </span>
    )
}

function GitFileRow(props: {
    file: GitFileStatus
    onOpen: () => void
    onOpenMenu: (point: AnchoredMenuPoint) => void
    showDivider: boolean
}) {
    const { t } = useTranslation()
    const subtitle = getProjectRootLabel(props.file.filePath, t)
    const rowHandlers = useFileMenuTrigger({
        onOpen: props.onOpen,
        onOpenMenu: props.onOpenMenu,
    })

    return (
        <button
            type="button"
            {...rowHandlers}
            className={`flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-[var(--app-subtle-bg)] transition-colors ${props.showDivider ? 'border-b border-[var(--app-divider)]' : ''}`}
        >
            <FileIcon fileName={props.file.fileName} size={22} />
            <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{props.file.fileName}</div>
                <div className="truncate text-xs text-[var(--app-hint)]">{subtitle}</div>
            </div>
            <div className="flex items-center gap-2">
                <LineChanges added={props.file.linesAdded} removed={props.file.linesRemoved} />
                <StatusBadge status={props.file.status} />
            </div>
        </button>
    )
}

function SearchResultRow(props: {
    file: FileSearchItem
    onOpen: () => void
    onOpenMenu: (point: AnchoredMenuPoint) => void
    showDivider: boolean
}) {
    const { locale } = useTranslation()
    const metadata = formatFileMetadata(props.file.size, props.file.modified, locale)
    const rowHandlers = useFileMenuTrigger({
        onOpen: props.onOpen,
        onOpenMenu: props.onOpenMenu,
    })
    const icon = props.file.fileType === 'file'
        ? <FileIcon fileName={props.file.fileName} size={22} />
        : <FolderIcon className="text-[var(--app-link)]" />

    return (
        <button
            type="button"
            {...rowHandlers}
            className={`flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-[var(--app-subtle-bg)] transition-colors ${props.showDivider ? 'border-b border-[var(--app-divider)]' : ''}`}
        >
            {icon}
            <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{props.file.fullPath}</div>
                {metadata ? <div className="text-xs text-[var(--app-hint)]">{metadata}</div> : null}
            </div>
        </button>
    )
}

function FileListSkeleton(props: { label: string; rows?: number }) {
    const titleWidths = ['w-1/3', 'w-1/2', 'w-2/3', 'w-2/5', 'w-3/5']
    const subtitleWidths = ['w-1/2', 'w-2/3', 'w-3/4', 'w-1/3']
    const rows = props.rows ?? 6

    return (
        <div className="p-3 animate-pulse space-y-3" role="status" aria-live="polite">
            <span className="sr-only">{props.label}</span>
            {Array.from({ length: rows }).map((_, index) => (
                <div key={`skeleton-row-${index}`} className="flex items-center gap-3">
                    <div className="h-6 w-6 rounded bg-[var(--app-subtle-bg)]" />
                    <div className="flex-1 space-y-2">
                        <div className={`h-3 ${titleWidths[index % titleWidths.length]} rounded bg-[var(--app-subtle-bg)]`} />
                        <div className={`h-2 ${subtitleWidths[index % subtitleWidths.length]} rounded bg-[var(--app-subtle-bg)]`} />
                    </div>
                </div>
            ))}
        </div>
    )
}

const SCROLL_KEY_PREFIX = 'hapi-dir-scroll-'

export default function FilesPage() {
    const { api, titleSuggestionAvailable = false } = useAppContext()
    const { t, locale } = useTranslation()
    const navigate = useNavigate()
    const queryClient = useQueryClient()
    const goBack = useAppGoBack()
    const { sessionId } = useParams({ from: '/sessions/$sessionId/files' })
    const search = useSearch({ from: '/sessions/$sessionId/files' })
    const { session } = useSession(api, sessionId)

    // Phone navigation: swipe right goes back to the chat from the diff view.
    const pageSwipeRef = useRef<HTMLDivElement>(null)
    useHorizontalSwipe(pageSwipeRef, {
        onSwipeRight: () => {
            navigate({
                to: '/sessions/$sessionId',
                params: { sessionId },
                ...PRESERVE_SESSION_SIDEBAR_SCROLL,
            })
        },
    })
    const scrollRef = useRef<HTMLDivElement>(null)

    const [activeTab, setActiveTab] = useState<FilesTab>(() => search.tab ?? readFilesTab())
    const [changesDisplay, setChangesDisplay] = useState<ChangesDisplay>(() =>
        search.display === 'diff' ? 'diff' : 'files'
    )
    const [directorySort, setDirectorySort] = useState<DirectorySort>(readDirectorySort)
    const [fileMenu, setFileMenu] = useState<{ path: string; point: AnchoredMenuPoint } | null>(null)
    const searchQuery = search.query ?? ''
    const changesView: ChangesView = search.comparison ?? 'working'
    const comparisonScope = changesView === 'working' ? null : changesView

    const openFileMenu = useCallback((path: string, point: AnchoredMenuPoint) => {
        setFileMenu({ path, point })
    }, [])

    const closeFileMenu = useCallback(() => setFileMenu(null), [])

    const setSearchQuery = useCallback((query: string) => {
        navigate({
            to: '/sessions/$sessionId/files',
            params: { sessionId },
            search: {
                ...(activeTab === 'directories' ? { tab: 'directories' as const } : {}),
                ...(query ? { query } : {}),
                ...(comparisonScope ? { comparison: comparisonScope } : {}),
            },
            replace: true,
            ...PRESERVE_SESSION_SIDEBAR_SCROLL,
        })
    }, [activeTab, comparisonScope, navigate, sessionId])

    useEffect(() => {
        try {
            localStorage.setItem(DIRECTORY_SORT_STORAGE_KEY, JSON.stringify(directorySort))
        } catch {
            // Sorting still works when storage is unavailable.
        }
    }, [directorySort])

    useEffect(() => {
        if (search.tab) {
            setActiveTab(search.tab)
            persistFilesTab(search.tab)
        }
    }, [search.tab])

    useEffect(() => {
        const el = scrollRef.current
        if (!el) return
        const key = `${SCROLL_KEY_PREFIX}${sessionId}:${activeTab}:${comparisonScope ?? 'working'}:${changesDisplay}`
        try {
            const saved = sessionStorage.getItem(key)
            if (saved !== null) el.scrollTop = Number(saved)
        } catch {
            // ignore
        }
        return () => {
            try {
                sessionStorage.setItem(key, String(el.scrollTop))
            } catch {
                // ignore
            }
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeTab, changesDisplay, comparisonScope, sessionId])

    const {
        status: gitStatus,
        error: gitError,
        isLoading: gitLoading,
        refetch: refetchGit
    } = useGitStatusFiles(api, sessionId)
    const {
        comparison,
        files: comparisonFiles,
        error: comparisonError,
        isLoading: comparisonLoading,
        refetch: refetchComparison
    } = useGitComparisonFiles(api, sessionId, comparisonScope)
    const fullDiffQuery = useQuery({
        queryKey: queryKeys.gitDiff(sessionId, comparisonScope ?? 'working'),
        queryFn: async () => {
            if (!api) throw new Error('Session unavailable')
            const result = await api.getGitDiff(sessionId, comparisonScope ?? undefined)
            if (!result.success) throw new Error(result.error ?? result.stderr ?? 'Full diff unavailable')
            return result.stdout ?? ''
        },
        enabled: Boolean(api && activeTab === 'changes' && changesDisplay === 'diff'),
        retry: false,
    })

    const shouldSearchProject = activeTab === 'directories' && Boolean(searchQuery)

    const searchResults = useSessionFileSearch(api, sessionId, searchQuery, {
        enabled: shouldSearchProject
    })
    const sortedSearchResults = useMemo(
        () => sortFileSearchItems(searchResults.files, directorySort, locale),
        [directorySort, locale, searchResults.files]
    )
    const normalizedSearchQuery = searchQuery.trim().toLocaleLowerCase(locale)
    const matchesSearchQuery = useCallback((file: GitFileStatus) => {
        if (!normalizedSearchQuery) return true
        return file.fullPath.toLocaleLowerCase(locale).includes(normalizedSearchQuery)
    }, [locale, normalizedSearchQuery])
    const filteredStagedFiles = useMemo(
        () => gitStatus?.stagedFiles.filter(matchesSearchQuery) ?? [],
        [gitStatus?.stagedFiles, matchesSearchQuery]
    )
    const filteredUnstagedFiles = useMemo(
        () => gitStatus?.unstagedFiles.filter(matchesSearchQuery) ?? [],
        [gitStatus?.unstagedFiles, matchesSearchQuery]
    )
    const filteredComparisonFiles = useMemo(
        () => comparisonFiles.filter(matchesSearchQuery),
        [comparisonFiles, matchesSearchQuery]
    )

    const handleOpenFile = useCallback((path: string, staged?: boolean) => {
        const fileSearch = {
            path: encodeBase64(path),
            ...(staged !== undefined ? { staged } : {}),
            ...(comparisonScope ? { comparison: comparisonScope } : {}),
            ...(activeTab === 'directories' ? { tab: 'directories' as const } : {}),
            ...(searchQuery ? { query: searchQuery } : {}),
        }
        navigate({
            to: '/sessions/$sessionId/file',
            params: { sessionId },
            search: fileSearch,
            ...PRESERVE_SESSION_SIDEBAR_SCROLL,
        })
    }, [activeTab, comparisonScope, navigate, searchQuery, sessionId])

    const handleAddFileToComposer = useCallback((path: string) => {
        appendFileReferenceToComposerDraft(sessionId, path)
        navigate({
            to: '/sessions/$sessionId',
            params: { sessionId },
            ...PRESERVE_SESSION_SIDEBAR_SCROLL,
        })
    }, [navigate, sessionId])

    const branchLabel = getDetachedBranchLabel(comparison?.branch ?? gitStatus?.branch, t)
    const activeGitError = comparisonScope ? comparisonError : gitError
    const activeGitLoading = comparisonScope ? comparisonLoading : gitLoading
    const showGitErrorBanner = Boolean(activeGitError)
    const gitErrorMessage = useMemo(
        () => {
            if (!activeGitError) return null
            return comparisonScope
                ? t('files.comparison.error', { error: activeGitError })
                : formatGitStatusError(activeGitError, t)
        },
        [activeGitError, comparisonScope, t]
    )
    const searchErrorMessage = useMemo(
        () => (searchResults.error ? formatFileSearchError(searchResults.error, t) : null),
        [searchResults.error, t]
    )
    const rootLabel = useMemo(() => {
        const base = session?.metadata?.path ?? sessionId
        const parts = base.split(/[/\\]/).filter(Boolean)
        return parts.length ? parts[parts.length - 1] : base
    }, [session?.metadata?.path, sessionId])
    const comparisonSummary = comparisonScope === 'last-commit'
        ? t('files.comparison.lastCommitSummary', {
            sha: comparison?.headSha?.slice(0, 7) ?? '',
            subject: comparison?.headSubject ?? ''
        })
        : comparisonScope === 'branch'
            ? t(
                comparison?.commitCount === 1
                    ? 'files.comparison.branchSummary.one'
                    : 'files.comparison.branchSummary.other',
                {
                    n: comparison?.commitCount ?? 0,
                    base: comparison?.baseBranch ?? t('files.comparison.defaultBranch')
                }
            )
            : null

    const handleRefresh = useCallback(() => {
        if (shouldSearchProject) {
            void queryClient.invalidateQueries({
                queryKey: queryKeys.sessionFiles(sessionId, searchQuery)
            })
            return
        }

        if (activeTab === 'directories') {
            void queryClient.invalidateQueries({
                queryKey: ['session-directory', sessionId]
            })
            return
        }

        if (comparisonScope) {
            void refetchComparison()
        } else {
            void refetchGit()
        }
        if (changesDisplay === 'diff') {
            void queryClient.invalidateQueries({ queryKey: queryKeys.gitDiff(sessionId, comparisonScope ?? 'working') })
        }
    }, [activeTab, changesDisplay, comparisonScope, queryClient, refetchComparison, refetchGit, searchQuery, sessionId, shouldSearchProject])

    const handleChangesViewChange = useCallback((nextView: ChangesView) => {
        navigate({
            to: '/sessions/$sessionId/files',
            params: { sessionId },
            search: {
                ...(nextView !== 'working' ? { comparison: nextView } : {}),
                ...(searchQuery ? { query: searchQuery } : {}),
            },
            replace: true,
            ...PRESERVE_SESSION_SIDEBAR_SCROLL,
        })
    }, [navigate, searchQuery, sessionId])

    const handleTabChange = useCallback((nextTab: FilesTab) => {
        setActiveTab(nextTab)
        persistFilesTab(nextTab)
        navigate({
            to: '/sessions/$sessionId/files',
            params: { sessionId },
            search: {
                ...(nextTab === 'directories' ? { tab: nextTab } : {}),
                ...(searchQuery ? { query: searchQuery } : {}),
                ...(comparisonScope ? { comparison: comparisonScope } : {}),
            },
            replace: true,
            ...PRESERVE_SESSION_SIDEBAR_SCROLL,
        })
    }, [comparisonScope, navigate, searchQuery, sessionId])

    const handleToggleFiles = useCallback(() => {
        navigate({
            to: '/sessions/$sessionId',
            params: { sessionId },
            ...PRESERVE_SESSION_SIDEBAR_SCROLL,
        })
    }, [navigate, sessionId])

    const handleToggleOutline = useCallback(() => {
        navigate({
            to: '/sessions/$sessionId',
            params: { sessionId },
            search: { outline: true },
            ...PRESERVE_SESSION_SIDEBAR_SCROLL,
        })
    }, [navigate, sessionId])

    if (!session) {
        return (
            <div className="flex flex-1 items-center justify-center p-4">
                <LoadingState label={t('loading.files')} className="text-sm" />
            </div>
        )
    }

    return (
        <div ref={pageSwipeRef} className="flex h-full min-h-0 flex-col">
            <SessionHeader
                session={session}
                onBack={goBack}
                onToggleFiles={session.metadata?.path ? handleToggleFiles : undefined}
                filesActive={true}
                onToggleOutline={handleToggleOutline}
                outlineActive={false}
                api={api}
                titleSuggestionAvailable={titleSuggestionAvailable}
                onSessionDeleted={goBack}
                onSessionReopened={async (newSessionId) => {
                    await transferComposerDraftThenNavigate(
                        session.id,
                        newSessionId,
                        () => navigate({
                            to: '/sessions/$sessionId/files',
                            params: { sessionId: newSessionId },
                            replace: true,
                            ...PRESERVE_SESSION_SIDEBAR_SCROLL,
                        }),
                    )
                }}
            />

            <div className="bg-[var(--app-bg)]">
                <div className="mx-auto flex w-full max-w-content items-center gap-2 border-b border-[var(--app-border)] p-3">
                    <div className="relative min-w-0 flex-1">
                        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--app-hint)]" />
                        <input
                            value={searchQuery}
                            onChange={(event) => setSearchQuery(event.target.value)}
                            placeholder={t(activeTab === 'changes'
                                ? 'files.page.searchChangesPlaceholder'
                                : 'files.page.searchProjectPlaceholder')}
                            className={`h-9 w-full rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] py-2 pl-9 text-sm text-[var(--app-fg)] outline-none placeholder:text-[var(--app-hint)] focus:border-[var(--app-link)] focus:ring-1 focus:ring-[var(--app-link)] ${activeTab === 'directories' ? 'pr-20' : 'pr-10'}`}
                            autoCapitalize="none"
                            autoCorrect="off"
                        />
                        {searchQuery ? (
                            <button
                                type="button"
                                onClick={() => setSearchQuery('')}
                                className="absolute inset-y-0 right-10 flex items-center rounded p-0.5 text-[var(--app-hint)] hover:text-[var(--app-fg)]"
                                title={t('sessions.search.clear')}
                                aria-label={t('sessions.search.clear')}
                            >
                                <CloseIcon className="h-3.5 w-3.5" />
                            </button>
                        ) : null}
                        {activeTab === 'directories' ? (
                            <div className="absolute inset-y-0 right-0 flex items-stretch">
                                <DirectorySortMenu sort={directorySort} onChange={setDirectorySort} embedded />
                            </div>
                        ) : null}
                    </div>
                    <Button
                        variant="outline"
                        type="button"
                        onClick={handleRefresh}
                        className="h-9 w-9 shrink-0 px-0"
                        title={t('files.page.refreshFilesystem')}
                        aria-label={t('files.page.refreshFilesystem')}
                    >
                        <RefreshIcon />
                    </Button>
                </div>
            </div>

            <div className="bg-[var(--app-bg)] border-b border-[var(--app-divider)]" role="tablist">
                <div className="mx-auto w-full max-w-content grid grid-cols-2">
                    <button
                        type="button"
                        role="tab"
                        aria-selected={activeTab === 'changes'}
                        onClick={() => handleTabChange('changes')}
                        className={`relative py-3 text-center text-sm font-semibold transition-colors hover:bg-[var(--app-subtle-bg)] ${activeTab === 'changes' ? 'text-[var(--app-fg)]' : 'text-[var(--app-hint)]'}`}
                    >
                        {t('files.tab.changes')}
                        <span
                            className={`absolute bottom-0 left-1/2 h-0.5 w-10 -translate-x-1/2 rounded-full ${activeTab === 'changes' ? 'bg-[var(--app-link)]' : 'bg-transparent'}`}
                        />
                    </button>
                    <button
                        type="button"
                        role="tab"
                        aria-selected={activeTab === 'directories'}
                        onClick={() => handleTabChange('directories')}
                        className={`relative py-3 text-center text-sm font-semibold transition-colors hover:bg-[var(--app-subtle-bg)] ${activeTab === 'directories' ? 'text-[var(--app-fg)]' : 'text-[var(--app-hint)]'}`}
                    >
                        {t('files.tab.directories')}
                        <span
                            className={`absolute bottom-0 left-1/2 h-0.5 w-10 -translate-x-1/2 rounded-full ${activeTab === 'directories' ? 'bg-[var(--app-link)]' : 'bg-transparent'}`}
                        />
                    </button>
                </div>
            </div>

            {(gitStatus || comparison) && activeTab === 'changes' ? (
                <div className="bg-[var(--app-bg)]">
                    <div className="mx-auto flex w-full max-w-content items-start gap-3 border-b border-[var(--app-divider)] px-3 py-2">
                        <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 text-sm">
                                <GitBranchIcon className="shrink-0 text-[var(--app-hint)]" />
                                <span className="truncate font-semibold">{branchLabel}</span>
                            </div>
                            <div className="truncate text-xs text-[var(--app-hint)]">
                                {comparisonSummary ?? t('files.branch.summary', {
                                    staged: gitStatus?.totalStaged ?? 0,
                                    unstaged: gitStatus?.totalUnstaged ?? 0,
                                })}
                            </div>
                        </div>
                        <label className="shrink-0">
                            <span className="sr-only">{t('files.comparison.label')}</span>
                            <select
                                value={changesView}
                                onChange={(event) => handleChangesViewChange(event.target.value as ChangesView)}
                                className="h-8 max-w-[10.5rem] rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] px-2 text-xs font-medium text-[var(--app-fg)] outline-none focus:border-[var(--app-link)] focus:ring-1 focus:ring-[var(--app-link)]"
                                aria-label={t('files.comparison.label')}
                            >
                                <option value="working">{t('files.comparison.working')}</option>
                                <option value="last-commit">{t('files.comparison.lastCommit')}</option>
                                <option value="branch">{t('files.comparison.branch')}</option>
                            </select>
                        </label>
                    </div>
                </div>
            ) : null}

            {activeTab === 'changes' ? (
                <div className="border-b border-[var(--app-divider)] bg-[var(--app-bg)]">
                    <div className="mx-auto flex w-full max-w-content gap-1 px-3 py-2" role="group" aria-label={t('files.display.label')}>
                        <button
                            type="button"
                            onClick={() => setChangesDisplay('files')}
                            className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${changesDisplay === 'files' ? 'bg-[var(--app-button)] text-[var(--app-button-text)]' : 'text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)]'}`}
                            aria-pressed={changesDisplay === 'files'}
                        >
                            {t('files.display.files')}
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                setChangesDisplay('diff')
                                if (searchQuery) setSearchQuery('')
                            }}
                            className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${changesDisplay === 'diff' ? 'bg-[var(--app-button)] text-[var(--app-button-text)]' : 'text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)]'}`}
                            aria-pressed={changesDisplay === 'diff'}
                        >
                            {t('files.display.fullDiff')}
                        </button>
                    </div>
                </div>
            ) : null}

            <div
                ref={scrollRef}
                data-hapi-session-files-scroll="true"
                className="app-scroll-y flex-1 min-h-0"
            >
                <div className="mx-auto w-full max-w-content">
                    {showGitErrorBanner && activeTab === 'changes' ? (
                        <div className="border-b border-[var(--app-divider)] bg-amber-500/10 px-3 py-2 text-xs text-[var(--app-hint)]">
                            {gitErrorMessage}
                        </div>
                    ) : null}
                    {activeTab === 'changes' && changesDisplay === 'diff' ? (
                        <div className="p-3">
                            {fullDiffQuery.isLoading ? (
                                <FileListSkeleton label={t('files.fullDiff.loading')} />
                            ) : fullDiffQuery.error ? (
                                <div className="rounded-md bg-amber-500/10 p-3 text-sm text-[var(--app-hint)]">
                                    {fullDiffQuery.error instanceof Error ? fullDiffQuery.error.message : t('files.fullDiff.error')}
                                </div>
                            ) : fullDiffQuery.data ? (
                                <UnifiedDiffDisplay diffContent={fullDiffQuery.data} showToolbar />
                            ) : (
                                <div className="p-6 text-sm text-[var(--app-hint)]">{t('files.fullDiff.empty')}</div>
                            )}
                        </div>
                    ) : activeTab === 'directories' && searchQuery ? (
                        searchResults.isLoading ? (
                            <FileListSkeleton label={t('loading.files')} />
                        ) : searchResults.error ? (
                            <div className="p-6 text-sm text-[var(--app-hint)]">{searchErrorMessage}</div>
                        ) : searchResults.files.length === 0 ? (
                            <div className="p-6 text-sm text-[var(--app-hint)]">
                                {t('files.search.empty')}
                            </div>
                        ) : (
                            <div className="border-t border-[var(--app-divider)]">
                                {sortedSearchResults.map((file, index) => (
                                    <SearchResultRow
                                        key={file.fullPath}
                                        file={file}
                                        onOpen={() => handleOpenFile(file.fullPath)}
                                        onOpenMenu={(point) => openFileMenu(file.fullPath, point)}
                                        showDivider={index < sortedSearchResults.length - 1}
                                    />
                                ))}
                            </div>
                        )
                    ) : activeTab === 'directories' ? (
                        <DirectoryTree
                            key={sessionId}
                            api={api}
                            sessionId={sessionId}
                            rootLabel={rootLabel}
                            onOpenFile={(path) => handleOpenFile(path)}
                            onRequestFileMenu={openFileMenu}
                            sort={directorySort}
                        />
                    ) : activeGitLoading ? (
                        <FileListSkeleton label={t('loading.git')} />
                    ) : (
                        <div>
                            {!comparisonScope && filteredStagedFiles.length ? (
                                <div>
                                    <div className="border-b border-[var(--app-divider)] bg-[var(--app-bg)] px-3 py-2 text-xs font-semibold text-[var(--app-git-staged-color)]">
                                        {t('files.changes.section.staged', { n: filteredStagedFiles.length })}
                                    </div>
                                    {filteredStagedFiles.map((file, index) => (
                                        <GitFileRow
                                            key={`staged-${file.fullPath}-${index}`}
                                            file={file}
                                            onOpen={() => handleOpenFile(file.fullPath, file.isStaged)}
                                            onOpenMenu={(point) => openFileMenu(file.fullPath, point)}
                                            showDivider={index < filteredStagedFiles.length - 1 || filteredUnstagedFiles.length > 0}
                                        />
                                    ))}
                                </div>
                            ) : null}

                            {!comparisonScope && filteredUnstagedFiles.length ? (
                                <div>
                                    <div className="border-b border-[var(--app-divider)] bg-[var(--app-bg)] px-3 py-2 text-xs font-semibold text-[var(--app-git-unstaged-color)]">
                                        {t('files.changes.section.unstaged', { n: filteredUnstagedFiles.length })}
                                    </div>
                                    {filteredUnstagedFiles.map((file, index) => (
                                        <GitFileRow
                                            key={`unstaged-${file.fullPath}-${index}`}
                                            file={file}
                                            onOpen={() => handleOpenFile(file.fullPath, file.isStaged)}
                                            onOpenMenu={(point) => openFileMenu(file.fullPath, point)}
                                            showDivider={index < filteredUnstagedFiles.length - 1}
                                        />
                                    ))}
                                </div>
                            ) : null}

                            {comparisonScope && filteredComparisonFiles.map((file, index) => (
                                <GitFileRow
                                    key={`${comparisonScope}-${file.fullPath}-${index}`}
                                    file={file}
                                    onOpen={() => handleOpenFile(file.fullPath)}
                                    onOpenMenu={(point) => openFileMenu(file.fullPath, point)}
                                    showDivider={index < filteredComparisonFiles.length - 1}
                                />
                            ))}

                            {!comparisonScope && !gitStatus ? (
                                <div className="p-6 text-sm text-[var(--app-hint)]">
                                    {t('files.changes.empty.unavailable')}
                                </div>
                            ) : null}

                            {!comparisonScope && gitStatus && searchQuery && filteredStagedFiles.length === 0 && filteredUnstagedFiles.length === 0 ? (
                                <div className="p-6 text-sm text-[var(--app-hint)]">
                                    {t('files.search.changesEmpty')}
                                </div>
                            ) : null}

                            {!comparisonScope && gitStatus && !searchQuery && gitStatus.stagedFiles.length === 0 && gitStatus.unstagedFiles.length === 0 ? (
                                <div className="p-6 text-sm text-[var(--app-hint)]">
                                    {t('files.changes.empty.none')}
                                </div>
                            ) : null}

                            {comparisonScope && !activeGitError && comparison?.success && searchQuery && filteredComparisonFiles.length === 0 ? (
                                <div className="p-6 text-sm text-[var(--app-hint)]">
                                    {t('files.search.changesEmpty')}
                                </div>
                            ) : null}

                            {comparisonScope && !activeGitError && comparison?.success && !searchQuery && comparisonFiles.length === 0 ? (
                                <div className="p-6 text-sm text-[var(--app-hint)]">
                                    {comparisonScope === 'last-commit'
                                        ? t('files.comparison.empty.lastCommit')
                                        : t('files.comparison.empty.branch', {
                                            base: comparison.baseBranch ?? t('files.comparison.defaultBranch')
                                        })}
                                </div>
                            ) : null}
                        </div>
                    )}
                </div>
            </div>

            <FileActionMenu
                isOpen={fileMenu !== null}
                onClose={closeFileMenu}
                relativePath={fileMenu?.path ?? ''}
                absolutePath={resolveAbsoluteFilePath(session.metadata?.path, fileMenu?.path ?? '')}
                anchorPoint={fileMenu?.point ?? { x: 0, y: 0 }}
                onAddToComposer={() => {
                    if (fileMenu) handleAddFileToComposer(fileMenu.path)
                }}
            />
        </div>
    )
}
