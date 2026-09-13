import {
    CREATABLE_AGENT_FLAVORS,
    getLaunchPermissionModesForFlavor,
    resolveHapiYoloPermissionMode,
    type PermissionMode
} from '@hapi/protocol'
import {
    CLAUDE_EFFORT_OPTIONS,
    CODEX_REASONING_EFFORT_OPTIONS,
    MODEL_OPTIONS,
    type AgentType,
    type CodexReasoningEffort,
    type LaunchEffort
} from './types'
import { LEGACY_YOLO_BRIDGE_AGENTS, usesSharedPermissionModeState } from '@/lib/codexFamilyPermissionAgents'

const AGENT_STORAGE_KEY = 'hapi:newSession:agent'
const YOLO_STORAGE_KEY = 'hapi:newSession:yolo'
const LAUNCH_SETTINGS_STORAGE_PREFIX = 'hapi:newSession:launchSettings:v1'
const CODEX_YOLO_DEFAULT_MIGRATION_KEY = 'hapi:newSession:codexYoloDefault:v1'

export type PreferredLaunchSettings = {
    model: string
    cursorSelectedBase: string
    effort: LaunchEffort
    modelReasoningEffort: CodexReasoningEffort
    permissionMode?: PermissionMode
}

// Only launchable flavors are valid defaults; a stale 'gemini' preference
// (no longer creatable) falls back to 'claude'.
const VALID_AGENTS = CREATABLE_AGENT_FLAVORS

export function loadPreferredAgent(): AgentType {
    try {
        const stored = localStorage.getItem(AGENT_STORAGE_KEY)
        if (stored && VALID_AGENTS.includes(stored as AgentType)) {
            return stored as AgentType
        }
    } catch {
        // Ignore storage errors
    }
    return 'codex'
}

export function savePreferredAgent(agent: AgentType): void {
    try {
        localStorage.setItem(AGENT_STORAGE_KEY, agent)
    } catch {
        // Ignore storage errors
    }
}

export function loadPreferredYoloMode(): boolean {
    try {
        return localStorage.getItem(YOLO_STORAGE_KEY) === 'true'
    } catch {
        return false
    }
}

export function savePreferredYoloMode(enabled: boolean): void {
    try {
        localStorage.setItem(YOLO_STORAGE_KEY, enabled ? 'true' : 'false')
    } catch {
        // Ignore storage errors
    }
}

function launchSettingsStorageKey(machineId: string, agent: AgentType): string {
    return `${LAUNCH_SETTINGS_STORAGE_PREFIX}:${encodeURIComponent(machineId)}:${agent}`
}

export function loadPreferredLaunchSettings(
    machineId: string,
    agent: AgentType
): PreferredLaunchSettings | null {
    try {
        const raw = localStorage.getItem(launchSettingsStorageKey(machineId, agent))
        if (!raw) {
            return null
        }
        const parsed = JSON.parse(raw) as Partial<PreferredLaunchSettings>
        if (!parsed || typeof parsed !== 'object' || typeof parsed.model !== 'string') {
            return null
        }
        const storedPermissionMode = typeof parsed.permissionMode === 'string'
            ? parsed.permissionMode
            : undefined
        let permissionMode = storedPermissionMode
            ? getLaunchPermissionModesForFlavor(agent).includes(storedPermissionMode as PermissionMode)
                ? storedPermissionMode as PermissionMode
                : 'default'
            : undefined
        // Existing installations may have persisted Codex "default" before
        // YOLO became this fork's initial launch mode. Migrate that value once;
        // later explicit choices remain respected.
        if (
            agent === 'codex'
            && storedPermissionMode === 'default'
            && localStorage.getItem(CODEX_YOLO_DEFAULT_MIGRATION_KEY) !== 'true'
        ) {
            permissionMode = 'yolo'
            localStorage.setItem(CODEX_YOLO_DEFAULT_MIGRATION_KEY, 'true')
        }
        return {
            model: parsed.model,
            cursorSelectedBase: typeof parsed.cursorSelectedBase === 'string'
                ? parsed.cursorSelectedBase
                : 'auto',
            effort: typeof parsed.effort === 'string' ? parsed.effort : 'auto',
            modelReasoningEffort: typeof parsed.modelReasoningEffort === 'string'
                ? parsed.modelReasoningEffort
                : 'default',
            ...(permissionMode ? { permissionMode } : {})
        }
    } catch {
        return null
    }
}

export function savePreferredLaunchSettings(
    machineId: string,
    agent: AgentType,
    settings: PreferredLaunchSettings
): void {
    try {
        if (agent === 'codex') {
            localStorage.setItem(CODEX_YOLO_DEFAULT_MIGRATION_KEY, 'true')
        }
        localStorage.setItem(
            launchSettingsStorageKey(machineId, agent),
            JSON.stringify(settings)
        )
    } catch {
        // Ignore storage errors
    }
}

function resolvePreferredOptionValue(
    preferredValue: string,
    availableValues: readonly string[],
    fallbackValue: string
): string {
    return availableValues.includes(preferredValue) ? preferredValue : fallbackValue
}

export function resolvePreferredLaunchSettings(
    agent: AgentType,
    preferred: PreferredLaunchSettings | null,
    legacyYolo = false
): PreferredLaunchSettings {
    const preferredModel = preferred?.model ?? 'auto'
    const staticModelValues = MODEL_OPTIONS[agent].map((option) => option.value)
    const model = staticModelValues.length > 0 && agent !== 'codex' && agent !== 'copilot'
        ? resolvePreferredOptionValue(preferredModel, staticModelValues, 'auto')
        : preferredModel
    const effort = agent === 'claude'
        ? resolvePreferredOptionValue(
            preferred?.effort ?? 'auto',
            CLAUDE_EFFORT_OPTIONS.map((option) => option.value),
            'auto'
        )
        : (preferred?.effort ?? 'auto')
    const modelReasoningEffort = agent === 'opencode'
        ? resolvePreferredOptionValue(
            preferred?.modelReasoningEffort ?? 'default',
            CODEX_REASONING_EFFORT_OPTIONS
                .filter((option) => option.value !== 'xhigh')
                .map((option) => option.value),
            'default'
        )
        : (preferred?.modelReasoningEffort ?? 'default')
    const usesSharedPermissionMode = usesSharedPermissionModeState(agent)
    const availablePermissionModes = getLaunchPermissionModesForFlavor(agent)
    const preferredPermissionMode = preferred?.permissionMode
    // A removed explicit mode falls back to Default, never to a stale YOLO toggle.
    const legacyYoloBridgeMode = preferredPermissionMode === undefined && legacyYolo && LEGACY_YOLO_BRIDGE_AGENTS.includes(agent)
        ? resolveHapiYoloPermissionMode(agent)
        : null
    const defaultPermissionMode = agent === 'codex' ? 'yolo' : 'default'
    const permissionMode = usesSharedPermissionMode
        ? preferredPermissionMode
            ? availablePermissionModes.includes(preferredPermissionMode)
                ? preferredPermissionMode
                : 'default'
            : legacyYoloBridgeMode && availablePermissionModes.includes(legacyYoloBridgeMode)
                ? legacyYoloBridgeMode
                : defaultPermissionMode
        : undefined

    return {
        model,
        cursorSelectedBase: preferred?.cursorSelectedBase ?? 'auto',
        effort,
        modelReasoningEffort,
        ...(permissionMode ? { permissionMode } : {})
    }
}
