import type { AgentFlavor } from './modes'

/** Speed is a launch setting, not a separate model in popularity statistics. */
export function normalizeUsageModelId(agent: AgentFlavor, model: string): string {
    const id = model.trim()
    if (agent !== 'cursor') return id
    const bracket = id.indexOf('[')
    if (bracket === -1) return id.replace(/-fast$/, '')
    const params = id.slice(bracket + 1, -1).split(',')
        .map(param => param.trim()).filter(param => param && !param.startsWith('fast=')).sort()
    return id.slice(0, bracket) + (params.length ? `[${params.join(',')}]` : '')
}
