import { describe, expect, it } from 'vitest';
import { buildTitleTurnReminder, TITLE_INSTRUCTION } from './systemPrompt';

describe('Codex title instruction', () => {
    it('keeps long-running session titles current and safe to scan', () => {
        expect(TITLE_INSTRUCTION).toContain('Reassess it on every user turn');
        expect(TITLE_INSTRUCTION).toContain('A title set manually by the user is not locked');
        expect(TITLE_INSTRUCTION).toContain('Write titles in Russian');
        expect(TITLE_INSTRUCTION).toContain('Git branch names');
        expect(TITLE_INSTRUCTION).toContain('task or ticket IDs');
    })

    it('builds a per-turn reminder with the current title treated as data', () => {
        const reminder = buildTitleTurnReminder('Old title');
        expect(reminder).toContain('"Old title"');
        expect(reminder).toContain('After reading the user message');
        expect(reminder).toContain('in Russian');
    })

    it('makes explicit regeneration unconditional and silent', () => {
        const reminder = buildTitleTurnReminder('Manual title', true);
        expect(reminder).toContain('explicitly requests regeneration');
        expect(reminder).toContain('even if the current title was set manually');
        expect(reminder).toContain('do not send user-facing text');
    })
})
