import { normalizeUsageModelId } from '@hapi/protocol'
import type { PopularModelsResponse } from '@hapi/protocol/apiTypes'
import type { ModelChoice } from './ModelChoices'
import { OPENCODE_HARDCODED_MODEL_ID } from './hardcodedModels'

/** Keep ranked choices first, then represent remaining agents in their picker order. */
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
    const represented = new Set(result.map(choice => choice.agent))
    for (const choice of choices) {
        if (represented.has(choice.agent)) continue
        result.push(selected?.agent === choice.agent ? selected : choice)
        represented.add(choice.agent)
    }
    // A selected alternative of an already ranked agent must stay accessible too.
    if (selected && !result.includes(selected)) result.push(selected)
    return result
}
