import { describe, expect, it } from 'vitest'
import {
    getCodexSpeedOptions,
    getEffectiveCodexServiceTier,
    getDisplayedCodexServiceTier,
    isFastServiceTier
} from './codexFastMode'

// Mirrors the real Codex catalog: the Fast tier's id is 'priority' and its
// display name is 'Fast', so the CLI captures both as lowercased tokens
// (['priority','fast']). Models without Fast advertise no such token.
const models = [
    { id: 'gpt-5.5', isDefault: true, serviceTiers: ['priority', 'fast'] },
    { id: 'gpt-5.4-mini', isDefault: false, serviceTiers: [] },
    { id: 'o3', isDefault: false },
    { id: 'gpt-6.2-sol', isDefault: false, serviceTiers: ['priority', 'ultrafast'] },
    { id: 'ultrafast-only', isDefault: false, serviceTiers: ['Ultrafast'] }
]

describe('getCodexSpeedOptions', () => {
    it.each([
        ['gpt-6.2-sol', ['standard', 'fast', 'ultrafast']],
        ['ultrafast-only', ['standard', 'ultrafast']],
        ['gpt-5.5', ['standard', 'fast']],
        [null, ['standard', 'fast']],
        ['gpt-5.4-mini', []],
        ['o3', []],
        ['unknown', []],
    ] as const)('offers the advertised speeds for %s', (model, expected) => {
        expect(getCodexSpeedOptions(model, models)).toEqual(expected)
    })

    it('keeps the speed control hidden without a catalog', () => {
        expect(getCodexSpeedOptions('gpt-6.2-sol', [])).toEqual([])
    })
})

describe('isFastServiceTier', () => {
    it('detects the fast tier regardless of casing/spacing', () => {
        expect(isFastServiceTier('fast')).toBe(true)
        expect(isFastServiceTier(' Fast ')).toBe(true)
        expect(isFastServiceTier('priority')).toBe(true)
    })

    it('treats null/standard as not fast', () => {
        expect(isFastServiceTier(null)).toBe(false)
        expect(isFastServiceTier(undefined)).toBe(false)
        expect(isFastServiceTier('standard')).toBe(false)
    })
})

describe('getEffectiveCodexServiceTier', () => {
    it('uses the active model default only when the session has no override', () => {
        const modelsWithDefault = models.map((model) => (
            model.id === 'gpt-5.5' ? { ...model, defaultServiceTier: 'priority' } : model
        ))

        expect(getEffectiveCodexServiceTier(null, null, modelsWithDefault)).toBe('priority')
        expect(getEffectiveCodexServiceTier('standard', null, modelsWithDefault)).toBe('standard')
    })
})

describe('getDisplayedCodexServiceTier', () => {
    it('displays untouched and explicit non-fast tiers as standard', () => {
        expect(getDisplayedCodexServiceTier(null)).toBe('standard')
        expect(getDisplayedCodexServiceTier(undefined)).toBe('standard')
        expect(getDisplayedCodexServiceTier('standard')).toBe('standard')
    })

    it.each(['fast', 'ultrafast'] as const)('preserves the %s selection', (tier) => {
        expect(getDisplayedCodexServiceTier(tier)).toBe(tier)
    })
})
