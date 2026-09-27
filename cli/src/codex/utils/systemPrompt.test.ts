import { describe, expect, it } from 'vitest';
import { TITLE_INSTRUCTION } from './systemPrompt';

describe('Codex title instruction', () => {
    it('keeps long-running session titles current and safe to scan', () => {
        expect(TITLE_INSTRUCTION).toContain('Reassess it on every user turn');
        expect(TITLE_INSTRUCTION).toContain('A title set manually by the user is not locked');
        expect(TITLE_INSTRUCTION).toContain('Write titles in Russian');
        expect(TITLE_INSTRUCTION).toContain('Git branch names');
        expect(TITLE_INSTRUCTION).toContain('task or ticket IDs');
    })
})
