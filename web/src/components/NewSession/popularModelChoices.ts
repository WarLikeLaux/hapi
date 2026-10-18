import { normalizeUsageModelId } from '@hapi/protocol'
import type { PopularModelsResponse } from '@hapi/protocol/apiTypes'
import type { ModelChoice } from './ModelChoices'
import { OPENCODE_HARDCODED_MODEL_ID } from './hardcodedModels'

/** Rank the current choices, keeping the actual selection even when it has no recent usage. */
export function popularModelChoices(choices: ModelChoice[], usage: PopularModelsResponse['models'], selected: ModelChoice | undefined): ModelChoice[] {
    const comparable = (value: string) => value.toLowerCase().replace(/-preview$/i, '').replace(/[^a-z0-9]/g, '')
    const ranked = choices.flatMap(choice => {
        const wire = choice.agent === 'opencode' && choice.value === 'auto' ? OPENCODE_HARDCODED_MODEL_ID : choice.value
        const count = usage.find(entry => entry.agent === choice.agent && (
            comparable(normalizeUsageModelId(choice.agent, entry.model)) === comparable(wire)
            || comparable(entry.model) === comparable(choice.label)
        ))
        return count ? [{ choice, count }] : []
    }).sort((left, right) => right.count.sessionCount - left.count.sessionCount || right.count.lastUsedAt - left.count.lastUsedAt)
    if (!ranked.length) return choices
    const result = ranked.map(entry => entry.choice)
    if (selected && !result.includes(selected)) result.push(selected)
    return result
}
