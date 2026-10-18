/**
 * Hardcoded model shortlists for the Create Session form.
 *
 * The desktop All agents filter combines these quick picks.
 * Wire ids are literals. Speed support is checked separately against discovery.
 * If a provider renames a model, update the literal.
 */

export const CODEX_DEFAULT_MODEL_ID = 'gpt-6.1-sol'
export const CODEX_LUNA_MODEL_ID = 'gpt-6-luna'
export const CODEX_ASTRA_MODEL_ID = 'gpt-6-astra'

export const CODEX_HARDCODED_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
    { value: CODEX_DEFAULT_MODEL_ID, label: 'GPT-6.1 Sol' },
    { value: CODEX_LUNA_MODEL_ID, label: 'GPT-6 Luna' },
    { value: CODEX_ASTRA_MODEL_ID, label: 'GPT-6 Astra' },
]

/** Antigravity runs the backend default (Gemini 3.8 Flash Medium); null = Default. */
export const AGY_HARDCODED_LABEL = 'Gemini 3.8 Flash (Medium)'
export const AGY_HIGH_MODEL_ID = 'gemini-3.8-flash-high'
export const AGY_HIGH_MODEL_LABEL = 'Gemini 3.8 Flash (High)'

/** Keep Flash as the native default; use a full id to bypass Claude aliases. */
export const CLAUDE_GLM_HARDCODED_LABEL = 'GLM 5.3 Flash'
export const CLAUDE_GLM_MODEL_ID = 'glm-5.3'
export const CLAUDE_GLM_MODEL_LABEL = 'GLM 5.3'

/** The first OpenCode badge explicitly selects Argon, independently of CLI defaults. */
export const OPENCODE_HARDCODED_MODEL_ID = 'opencode-go/gemini-4-argon-contributor'
export const OPENCODE_HARDCODED_LABEL = 'Gemini 4 Argon'
export const OPENCODE_HARDCODED_OPTIONS = [
    { value: 'auto', label: `${OPENCODE_HARDCODED_LABEL} (High)` },
    { value: 'opencode-go/muse-spark-1.3-contributor', label: 'Muse Spark 1.3 (Max)' },
    { value: 'opencode-go/deepseek-v4.1-flash', label: 'DeepSeek V4.1 Flash (Max)' },
]

/** MiniMax runs its native default; the raw catalog name keeps dashes and a Preview suffix. */
export const MINIMAX_HARDCODED_LABEL = 'MiniMax M3.1 Flash'
