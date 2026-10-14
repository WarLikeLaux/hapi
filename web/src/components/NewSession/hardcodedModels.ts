/**
 * Hardcoded model shortlists for the Create Session form.
 *
 * These flavors always run a single model on this machine, so the form shows
 * badges instead of a catalog dropdown. Wire ids are literals — no catalog
 * lookup, no resolution. If a provider renames a model, update the literal.
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

/** A GLM-branded claude runs GLM 5.3 Flash on `auto`; the selector is hidden. */
export const CLAUDE_GLM_HARDCODED_LABEL = 'GLM 5.3 Flash'

/** OpenCode runs the backend default; null = Default. */
export const OPENCODE_HARDCODED_MODEL_ID = 'opencode-go/muse-spark-1.3-contributor'
export const OPENCODE_HARDCODED_LABEL = 'Muse Spark 1.3 Contributor'

/** MiniMax runs its native default; the raw catalog name keeps dashes and a Preview suffix. */
export const MINIMAX_HARDCODED_LABEL = 'MiniMax M3.1 Flash'
