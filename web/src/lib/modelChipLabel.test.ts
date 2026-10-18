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
        { name: 'OpenCode Go/Gemini 4 Argon Contributor', wireId: 'opencode-go/gemini-4-argon-contributor', flavor: 'opencode', modelReasoningEffort: 'high', expected: 'Gemini 4 Argon (High)' },
        { name: 'opencode-go/deepseek-v4.1-flash', wireId: 'opencode-go/deepseek-v4.1-flash', flavor: 'opencode', modelReasoningEffort: 'max', expected: 'DeepSeek V4.1 Flash (Max)' },
    ])('formats $expected without extra Fast or empty parentheses', ({ expected, ...args }) => {
        expect(modelChipText(args)).toBe(expected)
    })

    it('does not invent an OpenCode effort when it is unknown', () => {
        expect(modelChipText({
            name: 'Muse Spark 1.3 Contributor',
            flavor: 'opencode',
        })).toBe('Muse Spark 1.3')
    })
})
