import { useCodeWrap } from '@/hooks/useCodeWrap'
import { WrapIcon } from '@/components/icons'
import { useTranslation } from '@/lib/use-translation'

export function UnifiedDiffDisplay(props: { diffContent: string; showToolbar?: boolean }) {
    const { t } = useTranslation()
    const { codeWrap, setCodeWrap } = useCodeWrap()
    const shouldWrap = props.showToolbar ? codeWrap : true
    const lines = props.diffContent.split('\n')

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
                {lines.map((line, index) => {
                    const isAdd = line.startsWith('+') && !line.startsWith('+++')
                    const isRemove = line.startsWith('-') && !line.startsWith('---')
                    const isHunk = line.startsWith('@@')
                    const isFileHeader = line.startsWith('diff --git ')
                    const isPathHeader = line.startsWith('+++') || line.startsWith('---')
                    const className = [
                        `${shouldWrap ? 'whitespace-pre-wrap break-words' : 'min-w-full w-max whitespace-pre'} px-3 py-0.5 text-xs font-mono`,
                        isAdd ? 'bg-[var(--app-diff-added-bg)] text-[var(--app-diff-added-text)]' : '',
                        isRemove ? 'bg-[var(--app-diff-removed-bg)] text-[var(--app-diff-removed-text)]' : '',
                        isHunk ? 'bg-[var(--app-subtle-bg)] text-[var(--app-hint)] font-semibold' : '',
                        isFileHeader ? 'mt-2 border-y border-[var(--app-divider)] bg-[var(--app-code-header-bg)] py-1.5 font-semibold text-[var(--app-fg)]' : '',
                        isPathHeader ? 'text-[var(--app-hint)] font-semibold' : ''
                    ].filter(Boolean).join(' ')

                    const style = isAdd
                        ? { borderLeft: '2px solid var(--app-git-staged-color)' }
                        : isRemove
                            ? { borderLeft: '2px solid var(--app-git-deleted-color)' }
                            : undefined

                    return <div key={`${index}-${line}`} className={className} style={style}>{line || ' '}</div>
                })}
            </div>
        </div>
    )
}
