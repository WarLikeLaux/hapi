import { useState } from 'react'
import { useCodeWrap } from '@/hooks/useCodeWrap'
import { WrapIcon } from '@/components/icons'
import { useTranslation } from '@/lib/use-translation'

type DiffSection = {
    header: string | null
    lines: string[]
}

function splitDiffSections(diffContent: string): DiffSection[] {
    const sections: DiffSection[] = []
    let current: DiffSection = { header: null, lines: [] }

    for (const line of diffContent.split('\n')) {
        if (line.startsWith('diff --git ')) {
            if (current.header !== null || current.lines.length > 0) sections.push(current)
            current = { header: line, lines: [] }
        } else {
            current.lines.push(line)
        }
    }
    if (current.header !== null || current.lines.length > 0) sections.push(current)
    return sections
}

function diffPath(header: string): string {
    const targetMarker = ' b/'
    const targetStart = header.lastIndexOf(targetMarker)
    return targetStart >= 0 ? header.slice(targetStart + targetMarker.length) : header
}

function ChevronIcon({ collapsed }: { collapsed: boolean }) {
    return (
        <svg
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`h-4 w-4 shrink-0 transition-transform ${collapsed ? '-rotate-90' : ''}`}
            aria-hidden="true"
        >
            <path d="m5 7.5 5 5 5-5" />
        </svg>
    )
}

export function UnifiedDiffDisplay(props: { diffContent: string; showToolbar?: boolean }) {
    const { t } = useTranslation()
    const { codeWrap, setCodeWrap } = useCodeWrap()
    const [collapsedSections, setCollapsedSections] = useState<Set<number>>(() => new Set())
    const shouldWrap = props.showToolbar ? codeWrap : true
    const sections = splitDiffSections(props.diffContent)

    const toggleSection = (index: number) => {
        setCollapsedSections((current) => {
            const next = new Set(current)
            if (next.has(index)) next.delete(index)
            else next.add(index)
            return next
        })
    }

    const renderLine = (line: string, key: string) => {
        const isAdd = line.startsWith('+') && !line.startsWith('+++')
        const isRemove = line.startsWith('-') && !line.startsWith('---')
        const isHunk = line.startsWith('@@')
        const isPathHeader = line.startsWith('+++') || line.startsWith('---')
        const className = [
            `${shouldWrap ? 'whitespace-pre-wrap break-words' : 'min-w-full w-max whitespace-pre'} px-3 py-0.5 text-xs font-mono`,
            isAdd ? 'bg-[var(--app-diff-added-bg)] text-[var(--app-diff-added-text)]' : '',
            isRemove ? 'bg-[var(--app-diff-removed-bg)] text-[var(--app-diff-removed-text)]' : '',
            isHunk ? 'bg-[var(--app-subtle-bg)] text-[var(--app-hint)] font-semibold' : '',
            isPathHeader ? 'text-[var(--app-hint)] font-semibold' : ''
        ].filter(Boolean).join(' ')

        const style = isAdd
            ? { borderLeft: '2px solid var(--app-git-staged-color)' }
            : isRemove
                ? { borderLeft: '2px solid var(--app-git-deleted-color)' }
                : undefined

        return <div key={key} className={className} style={style}>{line || ' '}</div>
    }

    return (
        <div className="rounded-md border border-[var(--app-border)] bg-[var(--app-bg)]">
            {props.showToolbar ? (
                <div className="sticky top-0 z-10 flex justify-end border-b border-[var(--app-divider)] bg-[var(--app-code-header-bg)] px-2 py-1">
                    <button
                        type="button"
                        onClick={() => setCodeWrap(!codeWrap)}
                        className={`rounded-md p-1 transition-colors hover:bg-[var(--app-code-copy-hover-bg)] ${codeWrap ? 'text-[var(--app-fg)]' : 'text-[var(--app-code-header-fg)]'}`}
                        aria-label={t(codeWrap ? 'code.wrap.disable' : 'code.wrap.enable')}
                        title={t(codeWrap ? 'code.wrap.disable' : 'code.wrap.enable')}
                        aria-pressed={codeWrap}
                    >
                        <WrapIcon className="h-3.5 w-3.5" />
                    </button>
                </div>
            ) : null}
            <div className="overflow-x-auto">
                {sections.map((section, sectionIndex) => {
                    const collapsed = collapsedSections.has(sectionIndex)
                    return (
                        <div key={`${sectionIndex}-${section.header ?? 'preamble'}`}>
                            {section.header ? (
                                <button
                                    type="button"
                                    onClick={() => toggleSection(sectionIndex)}
                                    aria-expanded={!collapsed}
                                    aria-label={t(collapsed ? 'diff.file.expand' : 'diff.file.collapse', { path: diffPath(section.header) })}
                                    title={t(collapsed ? 'diff.file.expand' : 'diff.file.collapse', { path: diffPath(section.header) })}
                                    className="mt-2 flex min-w-full w-max items-center gap-2 border-y border-[var(--app-divider)] bg-[var(--app-code-header-bg)] px-3 py-1.5 text-left text-xs font-mono font-semibold text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--app-link)]"
                                >
                                    <ChevronIcon collapsed={collapsed} />
                                    <span>{section.header}</span>
                                </button>
                            ) : null}
                            {!collapsed
                                ? section.lines.map((line, lineIndex) => renderLine(line, `${sectionIndex}-${lineIndex}-${line}`))
                                : null}
                        </div>
                    )
                })}
            </div>
        </div>
    )
}
