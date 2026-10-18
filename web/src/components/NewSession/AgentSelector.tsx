import { useId } from 'react'
import { getFlavorLabel } from '@hapi/protocol'
import type { AgentType } from './types'
import { AgentFlavorIcon } from '@/components/AgentFlavorIcon'
import { useTranslation } from '@/lib/use-translation'

export function AgentSelector(props: {
    agent: AgentType
    agents: readonly AgentType[]
    isDisabled: boolean
    onAgentChange: (value: AgentType) => void
}) {
    const { t } = useTranslation()
    const radioName = useId()

    return (
        <fieldset aria-label={t('newSession.agent')} className="min-w-0 p-2 sm:p-3">
            <div className="flex flex-wrap gap-2 sm:gap-3">
                {props.agents.map((agentType) => (
                    <label
                        key={agentType}
                        className="flex items-center gap-1.5 cursor-pointer"
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
                        <AgentFlavorIcon flavor={agentType} className="h-4 w-4 shrink-0" />
                        <span className="text-sm">{getFlavorLabel(agentType)}</span>
                    </label>
                ))}
            </div>
        </fieldset>
    )
}
