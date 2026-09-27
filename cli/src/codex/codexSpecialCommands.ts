import { stripHapiTitleReminder } from '@/modules/common/sessionTitlePrompt';

export type CodexSpecialCommand =
    | { type: 'clear' | 'compact' }
    | { type: 'invalid'; command: 'clear' | 'compact'; message: string }
    | { type: null };

/**
 * Parse Codex slash-commands. Strips a leading HAPI title-check block first
 * so `/clear` and `/compact` typed by the user still match after the central
 * reminder injection in `ApiSession.enqueueUserMessage`.
 */
export function parseCodexSpecialCommand(message: string): CodexSpecialCommand {
    const trimmed = stripHapiTitleReminder(message).trim();
    if (trimmed === '/clear') {
        return { type: 'clear' };
    }
    if (trimmed === '/compact') {
        return { type: 'compact' };
    }
    if (trimmed.startsWith('/clear ')) {
        return {
            type: 'invalid',
            command: 'clear',
            message: '/clear does not accept arguments'
        };
    }
    if (trimmed.startsWith('/compact ')) {
        return {
            type: 'invalid',
            command: 'compact',
            message: '/compact does not accept arguments'
        };
    }
    return { type: null };
}
