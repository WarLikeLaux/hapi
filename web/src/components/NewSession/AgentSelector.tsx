import { useId } from 'react'
import { getFlavorLabel } from '@hapi/protocol'
import type { AgentType } from './types'
import { AgentFlavorIcon } from '@/components/AgentFlavorIcon'
import { useTranslation } from '@/lib/use-translation'
import { ChoiceLabel } from './ChoiceLabel'
import { MuteControl } from './MuteControl'

export function AgentSelector(props: {
    agent: AgentType
    muted?: boolean
    onMutedChange?: (value: boolean) => void
    filter?: AgentType | 'all'
    showAllAgents?: boolean
    allowClear?: boolean
    onFilterChange?: (value: AgentType | 'all') => void
    agents: readonly AgentType[]
    isDisabled: boolean
    onAgentChange: (value: AgentType) => void
}) {
    const { t } = useTranslation()
    const radioName = useId()

    const choices: Array<AgentType | 'all'> = [
        ...(props.onFilterChange && props.showAllAgents !== false ? ['all' as const] : []),
        ...props.agents
    ]
    const choiceClass = (selected: boolean) => `inline-flex min-h-8 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[var(--app-link)] has-[:disabled]:opacity-50 ${selected
        ? 'border-[var(--app-link)] bg-[var(--app-link)] font-medium text-[var(--app-bg)]'
        : 'border-[var(--app-border)] bg-[var(--app-subtle-bg)] text-[var(--app-fg)] hover:bg-[var(--app-secondary-bg)]'}`
    const rows = Array.from({ length: Math.ceil(choices.length / 2) }, (_, index) => choices.slice(index * 2, index * 2 + 2))

    return (
        <fieldset aria-label={t('newSession.agent')} className="flex min-w-0 items-center gap-2 p-2 sm:gap-3 sm:p-3">
            <ChoiceLabel kind="agent" />
            <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-3">
                {rows.map((row, index) => <div key={index} className="flex flex-wrap items-center gap-x-2 gap-y-2 sm:contents">
                    {row.map(choice => choice === 'all' ? <label key="all" className={choiceClass(props.filter === 'all')}>
                        <input type="radio" name={radioName} value="all" checked={props.filter === 'all'}
                            onChange={() => props.onFilterChange?.('all')} disabled={props.isDisabled}
                            className="sr-only" />
                        <span >{t('newSession.allAgents')}</span>
                    </label> : <label key={choice} className={choiceClass((props.filter ?? props.agent) === choice)}>
                        <input type="radio" name={radioName} value={choice}
                            checked={(props.filter ?? props.agent) === choice}
                            onClick={() => { if (props.allowClear && props.filter === choice) props.onFilterChange?.('all') }}
                            onChange={() => props.onFilterChange ? props.onFilterChange(choice) : props.onAgentChange(choice)}
                            disabled={props.isDisabled} className="sr-only" />
                        <AgentFlavorIcon flavor={choice} className="h-3.5 w-3.5 shrink-0" />
                        <span >{getFlavorLabel(choice)}</span>
                    </label>)}
                </div>)}
                {props.muted !== undefined ? <span className="sm:ml-auto"><MuteControl muted={props.muted} disabled={props.isDisabled} onChange={value => props.onMutedChange?.(value)} /></span> : null}
            </div>
        </fieldset>
    )
}
