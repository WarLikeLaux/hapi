import { getAgyModelLabel, getClaudeModelLabel } from '@hapi/protocol'

type SessionModelSource = {
    model?: string | null
}

/** A row from a dynamic (ACP) model catalog. Shape mirrors `MinimaxModelSummary`. */
export type DynamicCatalogEntry = {
    modelId: string
    name?: string
}

export type SessionModelLabel = {
    key: 'session.item.model'
    value: string
}

function getModelLabel(model: string): string | null {
    return getAgyModelLabel(model) ?? getClaudeModelLabel(model)
}

/**
 * Find a dynamic catalog entry whose id matches `lookupId`.
 * Returns the entry or null. Lives here so header/thread/composer share the
 * same resolution rules; "active" catalog providers (minimax, ...) all flow
 * through this.
 */
export function findDynamicCatalogEntry(
    catalog: ReadonlyArray<DynamicCatalogEntry> | null | undefined,
    lookupId: string
): DynamicCatalogEntry | null {
    if (!catalog || catalog.length === 0) return null
    const trimmed = lookupId.trim()
    if (!trimmed) return null
    return catalog.find((entry) => entry.modelId === trimmed) ?? null
}

export function getSessionModelLabel(session: SessionModelSource): SessionModelLabel | null {
    const explicitModel = typeof session.model === 'string' ? session.model.trim() : ''
    if (explicitModel) {
        return {
            key: 'session.item.model',
            value: getModelLabel(explicitModel) ?? explicitModel
        }
    }

    return null
}

/**
 * Resolve the user-facing model label for a session, falling back to a live
 * ACP catalog when the session hasn't pinned an explicit `model`. Without this
 * fallback, dynamic providers (currently minimax) always surface "Default" in
 * the header and the bottom pill, even though the ACP session is actually
 * running a known model.
 *
 * Resolution order:
 *   1. Static label for explicit `session.model` (Claude/Agy presets) — or
 *      the raw id if it has no preset label.
 *   2. Dynamic catalog lookup by `session.model` (so a picked catalog id
 *      resolves to its friendly name, even though the static lookup above
 *      already returned it raw).
 *   3. Dynamic catalog lookup by `currentModelId` — the model the ACP session
 *      is actually using when no explicit pick was sent.
 *   4. None of the above: null.
 *
 * `catalogEnabled` is a hint that the dynamic catalog is meaningful right now
 * (e.g. active session for minimax). When false, skip the dynamic steps so
 * inactive or unloaded sessions don't transiently show a stale id.
 */
export function resolveSessionModelLabel(args: {
    session: SessionModelSource
    agentFlavor: string | null
    currentModelId?: string | null
    availableModels?: ReadonlyArray<DynamicCatalogEntry> | null
    catalogEnabled?: boolean
}): SessionModelLabel | null {
    const explicitModel = typeof args.session.model === 'string' ? args.session.model.trim() : ''

    if (explicitModel) {
        const staticLabel = getModelLabel(explicitModel)
        const dynamicEntry = findDynamicCatalogEntry(args.availableModels, explicitModel)
        const value = staticLabel ?? dynamicEntry?.name?.trim() ?? dynamicEntry?.modelId ?? explicitModel
        return { key: 'session.item.model', value }
    }

    if (!args.catalogEnabled || args.agentFlavor !== 'minimax') {
        return null
    }

    const lookupId = args.currentModelId?.trim() ?? ''
    if (!lookupId) return null

    const entry = findDynamicCatalogEntry(args.availableModels, lookupId)
    const value = entry?.name?.trim() || entry?.modelId || lookupId
    return { key: 'session.item.model', value }
}
