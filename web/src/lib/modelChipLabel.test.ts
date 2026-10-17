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

    it('adds fast without capitalizing it', () => {
        expect(modelChipText({
            name: 'grok-4.7-xhigh-fast',
            flavor: 'cursor',
        })).toBe('Grok 4.7 (XHigh, fast)')
    })

    it('uses the known Codex name and session effort', () => {
        expect(modelChipText({
            name: 'gpt-6.1-sol',
            flavor: 'codex',
            modelReasoningEffort: 'high',
            fast: true,
        })).toBe('GPT-6.1 Sol (High, fast)')
    })

    it('reads an empty OpenCode effort as Max', () => {
        expect(modelChipText({
            name: 'Muse Spark 1.3 Contributor',
            flavor: 'opencode',
        })).toBe('Muse Spark 1.3 Contributor (Max)')
    })
})
