import type { ReactNode } from 'react'
import { CLAUDE_GLM_DEFAULT_MODEL_LABEL } from '@hapi/protocol'
import type { AgentType } from './types'
import { MODEL_OPTIONS } from './types'
import { useClaudeGlmBranding } from '@/lib/claudeGlmBranding'
import { useTranslation } from '@/lib/use-translation'
import { SelectControl } from '@/components/ui/select-control'

export function ModelSelector(props: {
    agent: AgentType
    model: string
    label?: string
    options?: Array<{ value: string; label: string; group?: string }>
    isDisabled: boolean
    isLoading?: boolean
    error?: string | null
    onModelChange: (value: string) => void
    children?: ReactNode
}) {
    const { t } = useTranslation()
    const glmBranded = useClaudeGlmBranding()
    let options: Array<{ value: string; label: string; group?: string }> = props.options ?? MODEL_OPTIONS[props.agent]
    if (props.agent === 'claude' && glmBranded) {
        // A GLM-wired claude runs GLM 5.3 Flash when no model is picked, so
        // the no-pick option is named after it (same honesty as the codex
        // default), not a "Default" that hides what will actually run.
        options = options.map((option) => (option.value === 'auto'
            ? { ...option, label: CLAUDE_GLM_DEFAULT_MODEL_LABEL }
            : option))
    }
    if (options.length === 0) {
        return null
    }

    // Bucket by group without Object.groupBy (Safari < 17.4):
    // the web build has no polyfill for it.
    const groupedOptions = options.reduce<Record<string, typeof options>>((groups, option) => {
        const group = option.group ?? ''
        ;(groups[group] ??= []).push(option)
        return groups
    }, {})

    return (
        <div className="flex flex-col gap-1.5 px-3 py-3">
            <label className="text-xs font-medium text-[var(--app-hint)]">
                {props.label ?? t('newSession.model')}
            </label>
            <SelectControl
                value={props.model}
                onChange={(e) => props.onModelChange(e.target.value)}
                disabled={props.isDisabled || props.isLoading}
                className="py-2 pl-3 text-sm rounded-lg border border-[var(--app-divider)] bg-[var(--app-bg)] text-[var(--app-text)] focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
            >
                {Object.entries(groupedOptions).map(([group, grouped]) => group ? (
                    <optgroup key={group} label={group}>
                        {grouped.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                    </optgroup>
                ) : grouped.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                )))}
            </SelectControl>
            {props.children}
            {props.error ? (
                <div className="text-xs text-red-600">
                    {props.error}
                </div>
            ) : null}
        </div>
    )
}
