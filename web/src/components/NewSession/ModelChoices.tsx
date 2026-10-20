import { useId } from 'react'
import { getFlavorLabel } from '@hapi/protocol'
import { AgentFlavorIcon } from '@/components/AgentFlavorIcon'
import { useTranslation } from '@/lib/use-translation'
import { ChoiceLabel } from './ChoiceLabel'
import type { AgentType } from './types'

export type ModelChoice = { agent: AgentType; value: string; label: string }

// Effort stays in the accessible name. The picker shows it only for Antigravity.
export function modelChoiceLabel(label: string, keepEffort = false): string {
    if (keepEffort) return label
    return label.replace(/\s+(?:\((?:minimal|low|medium|high|extra[ -]?high|xhigh|max|ultra)\)|(?:minimal|low|medium|high|extra[ -]?high|xhigh|max|ultra))$/i, '')
}

export function ModelChoices(props: {
    options: readonly ModelChoice[]
    showAgent?: boolean
    isLoading?: boolean
    agent: AgentType
    model: string
    isDisabled: boolean
    onSelect: (choice: ModelChoice) => void
}) {
    const { t } = useTranslation()
    const descriptionId = useId()
    const key = (choice: ModelChoice) => `${choice.agent}:${choice.value}`
    const selectedKey = `${props.agent}:${props.model}`
    const choiceText = (choice: ModelChoice) => modelChoiceLabel(choice.label, choice.agent === 'agy')
    const chipClass = (choice: ModelChoice) => `inline-flex min-h-8 max-w-full shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--app-bg)] disabled:opacity-50 ${key(choice) === selectedKey
        ? 'border-[var(--app-link)] bg-[var(--app-link)] font-medium text-[var(--app-bg)]'
        : 'border-[var(--app-border)] bg-[var(--app-subtle-bg)] text-[var(--app-fg)] hover:bg-[var(--app-secondary-bg)]'}`
    if (!props.options.length && !props.isLoading) return null
    return (
        <section aria-label={t('newSession.model')} aria-busy={props.isLoading || undefined}
            title={props.showAgent ? t('newSession.popularModels.hint') : undefined}
            className="flex min-w-0 flex-col gap-2 p-2 sm:flex-row sm:items-center sm:gap-3 sm:p-3">
            <ChoiceLabel kind="model" />
            <div className="relative min-w-0 flex-1">
                <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
                {props.options.map((choice, index) => {
                    const selected = props.agent === choice.agent && props.model === choice.value
                    return <button
                        key={`${choice.agent}:${choice.value}`}
                        type="button"
                        aria-pressed={selected}
                        aria-label={choice.label}
                        aria-describedby={`${descriptionId}-${index}`}
                        title={`${getFlavorLabel(choice.agent)} · ${choice.label}`}
                        disabled={props.isDisabled}
                        onClick={() => props.onSelect(choice)}
                        className={chipClass(choice)}
                    >
                        <span id={`${descriptionId}-${index}`} className="sr-only">{getFlavorLabel(choice.agent)}</span>
                        {props.showAgent ? <AgentFlavorIcon flavor={choice.agent} className="h-3.5 w-3.5 shrink-0" /> : null}
                        <span className="min-w-0 truncate">{choiceText(choice)}</span>
                    </button>
                })}
                    {props.isLoading ? <span role="status" className="text-xs text-[var(--app-hint)]">{t('newSession.model.loading')}</span> : null}
                </div>
            </div>
        </section>
    )
}
