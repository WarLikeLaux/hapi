import type { ToolViewProps } from '@/components/ToolCard/views/_all'
import { isObject } from '@hapi/protocol'
import { UnifiedDiffDisplay } from '@/components/UnifiedDiffDisplay'
import { patchFiles } from '@/components/ToolCard/codexPatch'
import { useTranslation } from '@/lib/use-translation'
import { resolveDisplayPath } from '@/utils/path'

export function CodexPatchView(props: ToolViewProps) {
    const { t } = useTranslation()
    const input = isObject(props.block.tool.input) ? props.block.tool.input : {}
    const result = isObject(props.block.tool.result) ? props.block.tool.result : {}
    const completedFiles = patchFiles(result.changes)
    const files = completedFiles.length ? completedFiles : patchFiles(input.changes)
    const patch = typeof input.patch === 'string' ? input.patch : null

    const hasCompletedDiff = completedFiles.some(({ change }) =>
        typeof change.diff === 'string' || typeof change.unified_diff === 'string' || typeof change.content === 'string')
    if (patch && !hasCompletedDiff) {
        return (
            <div className="flex flex-col gap-2">
                <div className="text-xs text-[var(--app-hint)]">{t('tool.patch.proposed')}</div>
                <UnifiedDiffDisplay diffContent={patch} />
                {patch.includes('[hapi: truncated ') ? <div className="text-xs text-[var(--app-hint)]">{t('tool.patch.truncated')}</div> : null}
            </div>
        )
    }
    if (!files.length) return <div className="text-sm text-[var(--app-hint)]">{t('tool.patch.unavailable')}</div>

    return (
        <div className="flex min-w-0 flex-col gap-3">
            {props.block.tool.state !== 'completed' ? <div className="text-xs text-[var(--app-hint)]">{t('tool.patch.proposed')}</div> : null}
            {files.map(({ path, change }) => {
                const diff = typeof change.unified_diff === 'string' ? change.unified_diff
                    : typeof change.diff === 'string' ? change.diff : null
                const kind = typeof change.type === 'string' ? change.type : typeof change.kind === 'string' ? change.kind : ''
                const content = typeof change.content === 'string' ? change.content : null
                const text = diff ?? (content !== null && (kind === 'add' || kind === 'delete')
                    ? content.split('\n').map(line => `${kind === 'add' ? '+' : '-'}${line}`).join('\n') : null)
                return (
                    <div key={path} className="min-w-0">
                        <div className="mb-1 break-all font-mono text-sm text-[var(--app-fg)]">{resolveDisplayPath(path, props.metadata)}</div>
                        {text !== null ? (
                            <>
                                <UnifiedDiffDisplay diffContent={text} />
                                {text.includes('[hapi: truncated ') ? <div className="text-xs text-[var(--app-hint)]">{t('tool.patch.truncated')}</div> : null}
                            </>
                        ) : <div className="text-xs text-[var(--app-hint)]">{t('tool.patch.unavailable')}</div>}
                    </div>
                )
            })}
        </div>
    )
}
