import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parse } from 'yaml'
import { asString, getAgyModelLabel, isObject, type AgentFlavor } from '@hapi/protocol'
import { readCursorDefaultModelName } from '@/cursor/utils/cursorConfig'

/** Display hints only: the native CLI still resolves the model when no override is supplied. */
export function readAgentDefaultModelName(agent: AgentFlavor, env: NodeJS.ProcessEnv): string | null {
    if (agent === 'cursor') return readCursorDefaultModelName(env)
    const home = (process.platform === 'win32' ? env.USERPROFILE : env.HOME) || homedir()
    try {
        if (agent === 'agy') {
            const config: unknown = JSON.parse(readFileSync(join(home, '.gemini', 'antigravity-cli', 'settings.json'), 'utf8'))
            const model = isObject(config) ? asString(config.model)?.trim() : null
            return model ? getAgyModelLabel(model) ?? model : null
        }
        if (agent === 'minimax') {
            const directory = env.MINIMAX_DATA_DIR?.trim() || env.MAVIS_DATA_DIR?.trim() || join(home, '.minimax')
            const config: unknown = parse(readFileSync(join(directory, 'config.yaml'), 'utf8'))
            if (!isObject(config)) return null
            const modelId = asString(config.defaultModel)?.trim()
            if (!modelId) return null
            const slash = modelId.indexOf('/')
            const providerId = modelId.slice(0, slash)
            const modelKey = modelId.slice(slash + 1)
            const providers = isObject(config.provider) ? config.provider : null
            const provider = slash > 0 && providers && isObject(providers[providerId]) ? providers[providerId] : null
            const models = provider && isObject(provider.models) ? provider.models : null
            const model = models && isObject(models[modelKey]) ? models[modelKey] : null
            const name = model ? asString(model.name)?.trim() : null
            const providerName = provider ? asString(provider.name)?.trim() : null
            return name ? [providerName, name].filter(Boolean).join(' ') : modelId
        }
    } catch {
        // Unreadable configuration must never make an installed agent unavailable.
    }
    return null
}
