import { describe, expect, it } from 'vitest'
import { findDynamicCatalogEntry, getSessionModelLabel, resolveSessionModelLabel } from './sessionModelLabel'

describe('getSessionModelLabel', () => {
    it('prefers the explicit session model', () => {
        expect(getSessionModelLabel({ model: 'gpt-5.4' })).toEqual({
            key: 'session.item.model',
            value: 'gpt-5.4'
        })
    })

    it('renders friendly labels for known Claude aliases', () => {
        expect(getSessionModelLabel({ model: 'opus' })).toEqual({
            key: 'session.item.model',
            value: 'Opus'
        })
    })

    it('returns null when no model is available', () => {
        expect(getSessionModelLabel({})).toBeNull()
    })
})

describe('findDynamicCatalogEntry', () => {
    it('matches by trimmed modelId', () => {
        const entry = findDynamicCatalogEntry(
            [{ modelId: 'm:minimax:M2-Mini', name: 'M2-Mini' }],
            '  m:minimax:M2-Mini  '
        )
        expect(entry?.name).toBe('M2-Mini')
    })

    it('returns null when no row matches', () => {
        expect(findDynamicCatalogEntry(
            [{ modelId: 'm:minimax:M2-Mini', name: 'M2-Mini' }],
            'm:minimax:Something-Else'
        )).toBeNull()
    })

    it('returns null for empty catalog or empty lookup', () => {
        expect(findDynamicCatalogEntry([], 'm:minimax:M2-Mini')).toBeNull()
        expect(findDynamicCatalogEntry(undefined, 'm:minimax:M2-Mini')).toBeNull()
        expect(findDynamicCatalogEntry(null, 'm:minimax:M2-Mini')).toBeNull()
        expect(findDynamicCatalogEntry([{ modelId: 'x' }], '')).toBeNull()
        expect(findDynamicCatalogEntry([{ modelId: 'x' }], '   ')).toBeNull()
    })
})

describe('resolveSessionModelLabel', () => {
    const catalog = [
        { modelId: 'm:minimax:M2-Mini', name: 'M2-Mini' },
        { modelId: 'm:minimax:Other', name: 'Other Model' }
    ]

    it('returns the friendly name when an explicit pick is in the dynamic catalog', () => {
        expect(resolveSessionModelLabel({
            session: { model: 'm:minimax:M2-Mini' },
            agentFlavor: 'minimax',
            availableModels: catalog,
            catalogEnabled: true
        })).toEqual({ key: 'session.item.model', value: 'M2-Mini' })
    })

    it('falls back to the ACP currentModelId when no explicit pick was sent', () => {
        expect(resolveSessionModelLabel({
            session: { model: null },
            agentFlavor: 'minimax',
            currentModelId: 'm:minimax:M2-Mini',
            availableModels: catalog,
            catalogEnabled: true
        })).toEqual({ key: 'session.item.model', value: 'M2-Mini' })
    })

    it('uses the catalog modelId as fallback when no friendly name is supplied', () => {
        expect(resolveSessionModelLabel({
            session: { model: null },
            agentFlavor: 'minimax',
            currentModelId: 'm:minimax:M2-Mini',
            availableModels: [{ modelId: 'm:minimax:M2-Mini' }],
            catalogEnabled: true
        })).toEqual({ key: 'session.item.model', value: 'm:minimax:M2-Mini' })
    })

    it('returns the raw currentModelId when the catalog has not loaded yet', () => {
        // Real catalog fetch races with the first render — without catalog rows
        // we still want a readable label rather than a blank model field.
        expect(resolveSessionModelLabel({
            session: { model: null },
            agentFlavor: 'minimax',
            currentModelId: 'm:minimax:M2-Mini',
            availableModels: [],
            catalogEnabled: true
        })).toEqual({ key: 'session.item.model', value: 'm:minimax:M2-Mini' })
    })

    it('returns null when no model can be resolved (no explicit pick, no live id)', () => {
        expect(resolveSessionModelLabel({
            session: { model: null },
            agentFlavor: 'minimax',
            currentModelId: null,
            availableModels: catalog,
            catalogEnabled: true
        })).toBeNull()
    })

    it('skips the dynamic fallback when the catalog is not enabled (inactive session)', () => {
        expect(resolveSessionModelLabel({
            session: { model: null },
            agentFlavor: 'minimax',
            currentModelId: 'm:minimax:M2-Mini',
            availableModels: catalog,
            catalogEnabled: false
        })).toBeNull()
    })

    it('does not apply the dynamic fallback to non-minimax flavors', () => {
        expect(resolveSessionModelLabel({
            session: { model: null },
            agentFlavor: 'claude',
            currentModelId: 'm:minimax:M2-Mini',
            availableModels: catalog,
            catalogEnabled: true
        })).toBeNull()
    })

    it('keeps Claude preset labels for explicit picks with no catalog match', () => {
        expect(resolveSessionModelLabel({
            session: { model: 'opus' },
            agentFlavor: 'claude',
            availableModels: catalog,
            catalogEnabled: true
        })).toEqual({ key: 'session.item.model', value: 'Opus' })
    })

    it('explicit pick wins over currentModelId for dynamic providers', () => {
        expect(resolveSessionModelLabel({
            session: { model: 'm:minimax:Other' },
            agentFlavor: 'minimax',
            currentModelId: 'm:minimax:M2-Mini',
            availableModels: catalog,
            catalogEnabled: true
        })).toEqual({ key: 'session.item.model', value: 'Other Model' })
    })
})
