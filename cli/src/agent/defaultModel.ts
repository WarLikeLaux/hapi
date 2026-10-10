import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parse } from 'yaml'
import { parse as parseJsonc, type ParseError } from 'jsonc-parser'
import { asString, getAgyModelLabel, isObject, type AgentFlavor } from '@hapi/protocol'
import { readCursorDefaultModelName } from '@/cursor/utils/cursorConfig'

function readOpencodeDefaultModelName(env: NodeJS.ProcessEnv, home: string): string | null {
    // This is a machine-wide hint. Project-specific defaults come from ACP
    // when the user requests the catalog for the selected working directory.
    const configHome = env.XDG_CONFIG_HOME?.trim() || join(home, '.config')
    const configPaths = ['opencode.json', 'opencode.jsonc'].map((name) => join(configHome, 'opencode', name))
    if (env.OPENCODE_CONFIG?.trim()) configPaths.push(env.OPENCODE_CONFIG.trim())
    const customDirectory = env.OPENCODE_CONFIG_DIR?.trim()
    if (customDirectory) {
        configPaths.push(...['opencode.json', 'opencode.jsonc'].map((name) => join(customDirectory, name)))
    }

    let model: string | null = null
    const readModel = (content: string) => {
        const errors: ParseError[] = []
        const config: unknown = parseJsonc(content, errors, { allowTrailingComma: true })
        if (errors.length === 0 && isObject(config)) {
            model = asString(config.model)?.trim() || model
        }
    }
    for (const path of configPaths) {
        try {
            readModel(readFileSync(path, 'utf8'))
        } catch {
            // Optional config sources may be absent or unreadable.
        }
    }
    if (env.OPENCODE_CONFIG_CONTENT) readModel(env.OPENCODE_CONFIG_CONTENT)
    return model
}

/** Display hints only: the native CLI still resolves the model when no override is supplied. */
export function readAgentDefaultModelName(agent: AgentFlavor, env: NodeJS.ProcessEnv): string | null {
    if (agent === 'cursor') return readCursorDefaultModelName(env)
    const home = (process.platform === 'win32' ? env.USERPROFILE : env.HOME) || homedir()
    if (agent === 'opencode') return readOpencodeDefaultModelName(env, home)
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
