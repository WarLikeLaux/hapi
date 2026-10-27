import { getAgentConfigDescriptor, type PiThinkingLevelMap } from '@hapi/protocol'
import { getPiThinkingLevelOptions } from '@/components/AssistantChat/piThinkingLevelOptions'
import { useTranslation } from '@/lib/use-translation'
import { SelectControl } from '@/components/ui/select-control'
import type { AgentType, CodexReasoningEffort, LaunchEffort } from './types'
import { CLAUDE_EFFORT_OPTIONS, GROK_EFFORT_OPTIONS } from './types'
import { ChoiceLabel } from './ChoiceLabel'

export type EffortFieldProps = {
    agent: AgentType
    /** Launch-effort state (Claude / Grok / Pi). */
    effort: LaunchEffort
    onEffortChange: (value: string) => void
    /** Reasoning-effort state (Codex / OpenCode). */
    reasoningEffort: CodexReasoningEffort
    onReasoningEffortChange: (value: string) => void
    isDisabled: boolean
    /** Model-dependent launch-effort options (Grok). */
    grokOptions?: Array<{ value: string; label: string }>
    /** Model-dependent variant values from the OpenCode catalog (OpenCode). Array = dynamic list, [] = hide field, null/undefined = static fallback. */
    opencodeVariantOptions?: string[] | null
    codexOptions?: Array<{ value: string; label: string }>
    opencodeOptions?: Array<{ value: string; label: string }>
    /** Selected Pi model — hides effort when the model cannot reason and filters levels via thinkingLevelMap. */
    piSelectedModel?: { reasoning?: boolean; thinkingLevelMap?: PiThinkingLevelMap } | null
}

/**
 * Renders the Effort section of the create-session form from the agent's
 * configuration descriptor (see shared/src/agentConfig.ts).
 *
 * One component serves every flavor with an `effort` field:
 * - Claude: static launch-effort levels.
 * - Grok: model-dependent launch-effort levels.
 * - Pi: model-dependent thinking levels (filtered by the selected model's
 *   thinkingLevelMap; hidden when the model cannot reason).
 * Codex offers the selected model's supported reasoning levels as chips.
 * OpenCode offers model variants when its catalog provides them.
 */
export function EffortField(props: EffortFieldProps) {
    const { t } = useTranslation()
    if (props.agent === 'codex' || props.agent === 'opencode') {
        const options = props.agent === 'codex' ? props.codexOptions : props.opencodeOptions
        if (!options?.length) return null
        return (
            <section className="flex min-w-0 flex-col p-2 sm:flex-row sm:items-center sm:gap-3 sm:p-3" role="group" aria-label={t('newSession.effort')}>
                <ChoiceLabel kind="effort" />
                <div className="flex min-w-0 flex-1 flex-wrap gap-2 sm:gap-3">
                    {options.map((option) => (
                        <button
                            key={option.value}
                            type="button"
                            aria-pressed={props.reasoningEffort === option.value}
                            disabled={props.isDisabled}
                            onClick={() => props.onReasoningEffortChange(option.value)}
                            className={`rounded-full border px-2.5 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)] disabled:opacity-50 ${
                                props.reasoningEffort === option.value
                                    ? 'border-[var(--app-link)] bg-[var(--app-link)] font-medium text-[var(--app-bg)]'
                                    : 'border-[var(--app-border)] bg-[var(--app-subtle-bg)] text-[var(--app-fg)] hover:bg-[var(--app-secondary-bg)]'
                            }`}
                        >
                            {option.label}
                        </button>
                    ))}
                </div>
            </section>
        )
    }
    const descriptor = getAgentConfigDescriptor(props.agent)
    const field = descriptor.fields.find((candidate) => candidate.id === 'effort')
    if (!field) {
        return null
    }

    let options: Array<{ value: string; label: string }>
    if (props.agent === 'grok') {
        options = props.grokOptions ?? GROK_EFFORT_OPTIONS
    } else if (props.agent === 'pi') {
        if (props.piSelectedModel?.reasoning === false) {
            return null
        }
        options = [
            { value: 'auto', label: t('newSession.model.default') },
            ...getPiThinkingLevelOptions(props.effort, props.piSelectedModel?.thinkingLevelMap)
        ]
    } else {
        options = CLAUDE_EFFORT_OPTIONS
    }

    return (
        <div className="flex flex-col gap-1.5 px-3 py-3">
            <label className="text-xs font-medium text-[var(--app-hint)]">
                {t('newSession.effort')}{' '}
                <span className="font-normal">({t('newSession.model.optional')})</span>
            </label>
            <SelectControl
                value={props.effort}
                onChange={(e) => props.onEffortChange(e.target.value)}
                disabled={props.isDisabled}
                className="py-2 pl-3 text-sm rounded-lg border border-[var(--app-divider)] bg-[var(--app-bg)] text-[var(--app-text)] focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
            >
                {options.map((option) => (
                    <option key={option.value} value={option.value}>
                        {option.label}
                    </option>
                ))}
            </SelectControl>
        </div>
    )
}
