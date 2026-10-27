import { useId } from 'react'
import { getFlavorLabel } from '@hapi/protocol'
import type { AgentType } from './types'
import { AgentFlavorIcon } from '@/components/AgentFlavorIcon'
import { useTranslation } from '@/lib/use-translation'
import { ChoiceLabel } from './ChoiceLabel'

export function AgentSelector(props: {
    agent: AgentType
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

    return (
        <fieldset aria-label={t('newSession.agent')} className="flex min-w-0 flex-col p-2 sm:flex-row sm:items-center sm:gap-3 sm:p-3">
            <ChoiceLabel kind="agent" />
            <div className="flex min-w-0 flex-1 flex-wrap gap-2 sm:gap-3">
                {props.onFilterChange && props.showAllAgents !== false ? (
                    <label className="flex cursor-pointer items-center gap-1 sm:gap-1.5">
                        <input type="radio" name={radioName} value="all" checked={props.filter === 'all'}
                            onChange={() => props.onFilterChange?.('all')} disabled={props.isDisabled}
                            className="accent-[var(--app-link)]" />
                        <span className="whitespace-nowrap text-[13px] sm:text-sm">{t('newSession.allAgents')}</span>
                    </label>
                ) : null}
                {props.agents.map((agentType) => (
                    <label
                        key={agentType}
                        className="flex items-center gap-1 cursor-pointer sm:gap-1.5"
                    >
                        <input
                            type="radio"
                            name={radioName}
                            value={agentType}
                            checked={(props.filter ?? props.agent) === agentType}
                            onClick={() => {
                                if (props.allowClear && props.filter === agentType) props.onFilterChange?.('all')
                            }}
                            onChange={() => props.onFilterChange
                                ? props.onFilterChange(agentType)
                                : props.onAgentChange(agentType)}
                            disabled={props.isDisabled}
                            className="accent-[var(--app-link)]"
                        />
                        <AgentFlavorIcon flavor={agentType} className="h-3.5 w-3.5 shrink-0" />
                        <span className="whitespace-nowrap text-[13px] sm:text-sm">{getFlavorLabel(agentType)}</span>
                    </label>
                ))}
            </div>
        </fieldset>
    )
}
