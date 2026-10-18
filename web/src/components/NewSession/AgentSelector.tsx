import { useId } from 'react'
import { getFlavorLabel } from '@hapi/protocol'
import type { AgentType } from './types'
import { AgentFlavorIcon } from '@/components/AgentFlavorIcon'
import { useTranslation } from '@/lib/use-translation'
import { ChoiceLabel } from './ChoiceLabel'

export function AgentSelector(props: {
    agent: AgentType
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
                {props.agents.map((agentType) => (
                    <label
                        key={agentType}
                        className="flex items-center gap-1 cursor-pointer sm:gap-1.5"
                    >
                        <input
                            type="radio"
                            name={radioName}
                            value={agentType}
                            checked={props.agent === agentType}
                            onChange={() => props.onAgentChange(agentType)}
                            disabled={props.isDisabled}
                            className="accent-[var(--app-link)]"
                        />
                        <AgentFlavorIcon flavor={agentType} className="h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4" />
                        <span className="whitespace-nowrap text-[13px] sm:text-sm">{getFlavorLabel(agentType)}</span>
                    </label>
                ))}
            </div>
        </fieldset>
    )
}
