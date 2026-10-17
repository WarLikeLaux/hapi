import { describe, expect, it } from 'vitest'
import { modelChipText } from './modelChipLabel'

describe('modelChipText', () => {
    it('peels cursor wire suffixes into a name and capitalized effort', () => {
        expect(modelChipText({
            name: 'grok-4.7',
            wireId: 'grok-4.7-xhigh',
            flavor: 'cursor',
        })).toBe('Grok 4.7 (XHigh)')
    })

    it('puts Fast after the model name and keeps effort in parentheses', () => {
        expect(modelChipText({
            name: 'grok-4.7-xhigh-fast',
            flavor: 'cursor',
        })).toBe('Grok 4.7 Fast (XHigh)')
    })

    it('uses the known Codex name and session effort', () => {
        expect(modelChipText({
            name: 'gpt-6.1-sol',
            flavor: 'codex',
            modelReasoningEffort: 'high',
            fast: true,
        })).toBe('GPT-6.1 Sol Fast (High)')
    })

    it.each([
        { name: 'gpt-6.1-sol', flavor: 'codex', fast: true, expected: 'GPT-6.1 Sol Fast' },
        { name: 'gpt-6.1-sol', flavor: 'codex', fast: false, modelReasoningEffort: 'high', expected: 'GPT-6.1 Sol (High)' },
        { name: 'GPT-6.1-Sol', wireId: 'gpt-6.1-sol', flavor: 'codex', fast: true, modelReasoningEffort: 'high', expected: 'GPT-6.1 Sol Fast (High)' },
        { name: 'Composer 2.5 Fast', wireId: 'composer-2.5-fast', flavor: 'cursor', expected: 'Composer 2.5 Fast' },
        { name: 'composer-2.5[fast=false]', flavor: 'cursor', expected: 'Composer 2.5' },
    ])('formats $expected without extra Fast or empty parentheses', ({ expected, ...args }) => {
        expect(modelChipText(args)).toBe(expected)
    })

    it('reads an empty OpenCode effort as Max', () => {
        expect(modelChipText({
            name: 'Muse Spark 1.3 Contributor',
            flavor: 'opencode',
        })).toBe('Muse Spark 1.3 Contributor (Max)')
    })
})
