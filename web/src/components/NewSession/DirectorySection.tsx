import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import * as Popover from '@radix-ui/react-popover'
import type { Suggestion } from '@/hooks/useActiveSuggestions'
import { Autocomplete } from '@/components/ChatInput/Autocomplete'
import { FloatingOverlay } from '@/components/ChatInput/FloatingOverlay'
import { getProjectLabelHue } from '@/components/SessionRowSummary'
import { useTranslation } from '@/lib/use-translation'
import { basename } from '@/utils/path'


function CodexImportIcon(props: { className?: string }) {
    return (
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
            className={props.className}
        >
            {/* 中文注释：导入 Codex 历史依赖当前目录，放在 Browse 后面表达“选目录后导入”；图标用“下载进托盘”样式，与刷新图标区分。 */}
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="12" x2="12" y2="3" />
        </svg>
    )
}

function FolderIcon(props: { className?: string }) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={props.className}>
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1-2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        </svg>
    )
}

function PathChip(props: {
    path: string
    isDisabled: boolean
    onPathClick: (path: string) => void
    aliases?: Record<string, string>
}) {
    return (
        <button
            key={props.path}
            type="button"
            onClick={() => props.onPathClick(props.path)}
            disabled={props.isDisabled}
            className="shrink-0 rounded-[5px] border border-[var(--session-project-border)] bg-[var(--session-project-bg)] px-2 py-1 text-xs font-medium leading-tight text-[var(--session-project-fg)] transition-[filter] hover:brightness-110 truncate max-w-[200px] disabled:opacity-50"
            style={{
                // Same hue hashing as the session list project
                // badges, so one project keeps its color in both.
                '--session-project-fg': `light-dark(hsl(${getProjectLabelHue(props.path)} 78% 27%), hsl(${getProjectLabelHue(props.path)} 95% 88%))`,
                '--session-project-bg': `light-dark(hsl(${getProjectLabelHue(props.path)} 92% 89%), hsl(${getProjectLabelHue(props.path)} 68% 30%))`,
                '--session-project-border': `light-dark(hsl(${getProjectLabelHue(props.path)} 70% 72%), hsl(${getProjectLabelHue(props.path)} 68% 45%))`,
            } as CSSProperties}
            title={props.path}
            aria-label={props.path}
        >
            {props.aliases?.[props.path] || basename(props.path)}
        </button>
    )
}

type PathRowProps = {
    label: string
    paths: readonly string[]
    isDisabled: boolean
    onPathClick: (path: string) => void
    aliases?: Record<string, string>
}

function PathRow(props: PathRowProps) {
    if (props.paths.length === 0) return null
    return (
        <div className="flex flex-col gap-1 mt-1">
            <span className="text-xs text-[var(--app-hint)]">{props.label}:</span>
            <div className="flex flex-wrap gap-x-2 gap-y-3">
                {props.paths.map((path) => (
                    <PathChip
                        key={path}
                        path={path}
                        aliases={props.aliases}
                        isDisabled={props.isDisabled}
                        onPathClick={props.onPathClick}
                    />
                ))}
            </div>
        </div>
    )
}

/** Two compact rows on phones, one full row on wider screens. */
function RecentPathRow(props: PathRowProps) {
    const { t } = useTranslation()
    const [visibleCount, setVisibleCount] = useState(props.paths.length)
    const [open, setOpen] = useState(false)
    const measurements = useRef<HTMLDivElement>(null)
    const container = useRef<HTMLDivElement>(null)
    const labelId = useId()
    useEffect(() => { setOpen(false) }, [visibleCount, props.isDisabled])
    useLayoutEffect(() => {
        const root = container.current
        const samples = measurements.current
        if (!root || !samples) return
        const wide = window.matchMedia('(min-width: 640px)')
        let disposed = false
        function measure() {
            if (disposed || !root || !samples) return
            const width = root.getBoundingClientRect().width
            if (!width) return
            const children = Array.from(samples.children) as HTMLElement[]
            const moreWidth = children.pop()!.getBoundingClientRect().width
            const widths = children.map(child => child.getBoundingClientRect().width)
            const gap = parseFloat(getComputedStyle(samples).columnGap)
            function fits(items: number[]) {
                let row = 1
                let used = 0
                for (const item of items) {
                    if (used && used + gap + item > width + 0.5) { row++; used = 0 }
                    used += (used ? gap : 0) + item
                    if (row > (wide.matches ? 1 : 2)) return false
                }
                return true
            }
            let count = widths.length
            if (!fits(widths)) {
                while (count && !fits([...widths.slice(0, count), moreWidth])) count--
            }
            setVisibleCount(count)
        }
        measure()
        const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
        observer?.observe(root)
        wide.addEventListener('change', measure)
        void document.fonts?.ready.then(measure)
        return () => { disposed = true; observer?.disconnect(); wide.removeEventListener('change', measure) }
    }, [props.paths])
    const remaining = props.paths.slice(visibleCount)
    const more = <button type="button" disabled={props.isDisabled} aria-label={t('newSession.moreRecentPaths')} title={t('newSession.moreRecentPaths')}
        className="flex h-[25px] w-8 shrink-0 items-center justify-center rounded-[5px] border border-[var(--app-border)] text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)] focus-visible:outline-2 focus-visible:outline-[var(--app-link)] disabled:opacity-50">
        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" /></svg>
    </button>
    if (!props.paths.length) return null
    return <div className="relative mt-1 flex min-w-0 flex-col gap-1">
        <span id={labelId} className="text-xs text-[var(--app-hint)]">{props.label}:</span>
        <div className="pointer-events-none invisible absolute inset-0 overflow-hidden" aria-hidden="true">
            <div ref={measurements} className="flex w-max gap-2">
                {props.paths.map(path => <PathChip aliases={props.aliases} key={path} path={path} isDisabled onPathClick={props.onPathClick} />)}
                {more}
            </div>
        </div>
        <div ref={container} role="group" aria-labelledby={labelId} className="flex min-w-0 flex-wrap gap-2">
            {props.paths.slice(0, visibleCount).map(path => <PathChip aliases={props.aliases} key={path} path={path} isDisabled={props.isDisabled} onPathClick={props.onPathClick} />)}
            {remaining.length ? <Popover.Root open={open && !props.isDisabled} onOpenChange={setOpen}>
                <Popover.Trigger asChild>{more}</Popover.Trigger>
                <Popover.Portal><Popover.Content aria-label={t('newSession.moreRecentPaths')} side="bottom" align="end" sideOffset={6} collisionPadding={12}
                    className="z-50 flex max-h-[min(22rem,var(--radix-popover-content-available-height))] w-[min(24rem,calc(100vw-1.5rem))] flex-wrap gap-2 overflow-y-auto rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] p-3 text-[var(--app-fg)] shadow-lg">
                    {remaining.map(path => <PathChip aliases={props.aliases} key={path} path={path} isDisabled={props.isDisabled} onPathClick={path => { props.onPathClick(path); setOpen(false) }} />)}
                </Popover.Content></Popover.Portal>
            </Popover.Root> : null}
        </div>
    </div>
}

export function DirectorySection(props: {
    label?: string
    directory: string
    suggestions: readonly Suggestion[]
    selectedIndex: number
    isDisabled: boolean
    workPaths: string[]
    recentPaths: string[]
    aliases?: Record<string, string>
    statusMessage?: string | null
    statusTone?: 'warning' | 'error' | null
    onDirectoryChange: (value: string) => void
    onDirectoryFocus: () => void
    onDirectoryBlur: () => void
    onDirectoryKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => void
    onSuggestionSelect: (index: number) => void
    onPathClick: (path: string) => void
    onChooseFolder?: () => void
    onImportCodexHistory?: () => void
    isImportingCodexHistory?: boolean
}) {
    const { t } = useTranslation()
    const inputId = useId()

    return (
        <div className="flex flex-col gap-1.5 px-3 py-3">
            <div className="flex items-center justify-between gap-2">
                <label htmlFor={inputId} className="text-xs font-medium text-[var(--app-hint)]">
                    {props.label ?? t('newSession.directory')}
                </label>
            </div>
            <div className="flex items-start gap-2">
                <div className="relative flex-1 min-w-0">
                    <input
                        id={inputId}
                        type="text"
                        placeholder={t('newSession.placeholder')}
                        value={props.directory}
                        onChange={(event) => props.onDirectoryChange(event.target.value)}
                        onKeyDown={props.onDirectoryKeyDown}
                        onFocus={props.onDirectoryFocus}
                        onBlur={props.onDirectoryBlur}
                        disabled={props.isDisabled}
                        className="w-full rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] p-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
                    />
                    {props.suggestions.length > 0 && (
                        <div className="absolute top-full left-0 right-0 z-10 mt-1">
                            <FloatingOverlay maxHeight={200}>
                                <Autocomplete
                                    suggestions={props.suggestions}
                                    selectedIndex={props.selectedIndex}
                                    onSelect={props.onSuggestionSelect}
                                />
                            </FloatingOverlay>
                        </div>
                    )}
                </div>
                {props.onChooseFolder && (
                    <button
                        type="button"
                        onClick={props.onChooseFolder}
                        disabled={props.isDisabled}
                        className="self-stretch shrink-0 flex items-center gap-1 rounded-md border border-[var(--app-border)] bg-[var(--app-subtle-bg)] px-2 py-2 text-xs text-[var(--app-fg)] hover:bg-[var(--app-secondary-bg)] transition-colors disabled:opacity-50"
                        title={t('newSession.browse')}
                    >
                        <FolderIcon className="h-3.5 w-3.5" />
                        {t('newSession.browse')}
                    </button>
                )}

                {props.onImportCodexHistory ? (
                    <button
                        type="button"
                        onClick={props.onImportCodexHistory}
                        disabled={props.isDisabled || props.isImportingCodexHistory}
                        aria-label={t('codexSync.tooltip')}
                        aria-busy={props.isImportingCodexHistory}
                        className="shrink-0 flex items-center gap-1 rounded-md border border-[var(--app-border)] bg-[var(--app-subtle-bg)] px-2 py-2 text-xs text-[var(--app-fg)] hover:bg-[var(--app-secondary-bg)] transition-colors disabled:opacity-50"
                        title={t('codexSync.tooltip')}
                    >
                        <CodexImportIcon className={`h-3.5 w-3.5 ${props.isImportingCodexHistory ? 'animate-spin' : ''}`} />
                        {t('codexSync.newSessionAction')}
                    </button>
                ) : null}
            </div>

            <PathRow
                aliases={props.aliases}
                label={t('newSession.working')}
                paths={props.workPaths}
                isDisabled={props.isDisabled}
                onPathClick={props.onPathClick}
            />
            <RecentPathRow
                aliases={props.aliases}
                label={t('newSession.recent')}
                paths={props.recentPaths}
                isDisabled={props.isDisabled}
                onPathClick={props.onPathClick}
            />

            {props.statusMessage ? (
                <div
                    className={`mt-1 rounded-md px-2 py-1 text-xs ${
                        props.statusTone === 'error'
                            ? 'bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400'
                            : 'bg-amber-500/10 text-[var(--app-hint)]'
                    }`}
                >
                    {props.statusMessage}
                </div>
            ) : null}
        </div>
    )
}
