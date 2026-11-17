import type { CodexServiceTier } from '@hapi/protocol/schemas'

export const STANDARD_FAST_SPEEDS = ['standard', 'fast'] as const

export const CODEX_SPEED_LABELS = {
    standard: 'misc.fastModeStandard',
    fast: 'misc.fastModeFast',
    ultrafast: 'misc.fastModeUltrafast'
} as const satisfies Record<CodexServiceTier, string>

type CodexModelCatalogEntry = {
    id: string
    isDefault: boolean
    defaultServiceTier?: string | null
    serviceTiers?: string[]
}

/**
 * Resolve the catalog entry for the session's active model. A null/empty
 * session model means "auto" — the catalog's default model is active.
 */
function findActiveModel<T extends CodexModelCatalogEntry>(
    sessionModel: string | null | undefined,
    models: ReadonlyArray<T>
): T | undefined {
    const normalized = sessionModel?.trim().toLowerCase()
    if (normalized) {
        return models.find((model) => model.id.trim().toLowerCase() === normalized)
    }
    return models.find((model) => model.isDefault)
}

export function getCodexSpeedOptions(
    sessionModel: string | null | undefined,
    models: ReadonlyArray<CodexModelCatalogEntry>
): readonly CodexServiceTier[] {
    const tiers = findActiveModel(sessionModel, models)?.serviceTiers ?? []
    const speeds: CodexServiceTier[] = []
    if (tiers.some(isFastServiceTier)) speeds.push('fast')
    if (tiers.some(tier => tier.trim().toLowerCase() === 'ultrafast')) speeds.push('ultrafast')
    return speeds.length > 0 ? ['standard', ...speeds] : []
}

export function isFastServiceTier(serviceTier?: string | null): boolean {
    return /^(fast|priority)$/i.test(serviceTier?.trim() ?? '')
}

export function getEffectiveCodexServiceTier(
    serviceTier: string | null | undefined,
    sessionModel: string | null | undefined,
    models: ReadonlyArray<CodexModelCatalogEntry>
): string | null | undefined {
    return serviceTier ?? findActiveModel(sessionModel, models)?.defaultServiceTier
}

/** Display an untouched tier as Standard without setting an override. */
export function getDisplayedCodexServiceTier(serviceTier?: string | null): CodexServiceTier {
    if (isFastServiceTier(serviceTier)) return 'fast'
    return serviceTier?.trim().toLowerCase() === 'ultrafast' ? 'ultrafast' : 'standard'
}
