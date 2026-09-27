/**
 * Parsers for special commands that require dedicated remote session handling
 */

import { stripHapiTitleReminder } from '@/modules/common/sessionTitlePrompt'

export interface CompactCommandResult {
    isCompact: boolean;
    originalMessage: string;
}

export interface ClearCommandResult {
    isClear: boolean;
}

export interface PlanCommandResult {
    isPlan: boolean;
    mode: 'plan' | 'default';
    prompt?: string;
}

export interface SpecialCommandResult {
    type: 'compact' | 'clear' | 'plan' | null;
    originalMessage?: string;
    mode?: 'plan' | 'default';
    prompt?: string;
}

/**
 * Parse /compact command
 * Matches messages starting with "/compact " or exactly "/compact".
 *
 * `ApiSession.enqueueUserMessage` prepends a hidden HAPI title-check block to
 * fresh remote prompts; strip it before matching so `/compact` still works
 * for users who type the command directly.
 */
export function parseCompact(message: string): CompactCommandResult {
    const cleaned = stripHapiTitleReminder(message);
    const trimmed = cleaned.trim();

    if (trimmed === '/compact') {
        return {
            isCompact: true,
            originalMessage: trimmed
        };
    }

    if (trimmed.startsWith('/compact ')) {
        return {
            isCompact: true,
            originalMessage: trimmed
        };
    }

    return {
        isCompact: false,
        originalMessage: message
    };
}

/**
 * Parse /clear command
 * Only matches exactly "/clear". Strips a leading HAPI title-check block so
 * `/clear` works the same way the user typed it.
 */
export function parseClear(message: string): ClearCommandResult {
    const cleaned = stripHapiTitleReminder(message);
    const trimmed = cleaned.trim();

    return {
        isClear: trimmed === '/clear'
    };
}

function stripMatchingQuotes(value: string): string {
    const trimmed = value.trim();
    if (trimmed.length < 2) {
        return trimmed;
    }

    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === '\'' && last === '\'')) {
        return trimmed.slice(1, -1).trim();
    }

    return trimmed;
}

/**
 * Parse /plan command for remote Claude sessions.
 * - /plan: switch to Claude plan permission mode.
 * - /plan off: switch back to default mode.
 * - /plan <prompt>: switch to plan mode and send the remaining prompt.
 *
 * Strips a leading HAPI title-check block before matching.
 */
export function parsePlan(message: string): PlanCommandResult {
    const cleaned = stripHapiTitleReminder(message);
    const trimmed = cleaned.trim();
    const match = /^\/plan(?:\s+([\s\S]*))?$/i.exec(trimmed);
    if (!match) {
        return {
            isPlan: false,
            mode: 'plan'
        };
    }

    const rawArg = match[1]?.trim() ?? '';
    if (rawArg.toLowerCase() === 'off') {
        return {
            isPlan: true,
            mode: 'default'
        };
    }

    return {
        isPlan: true,
        mode: 'plan',
        prompt: rawArg ? stripMatchingQuotes(rawArg) : undefined
    };
}

/**
 * Unified parser for special commands
 * Returns the type of command and original message if applicable.
 * Strips a leading HAPI title-check block from the message before matching
 * so slash-commands typed by the user always win over injected reminders.
 */
export function parseSpecialCommand(message: string): SpecialCommandResult {
    const compactResult = parseCompact(message);
    if (compactResult.isCompact) {
        return {
            type: 'compact',
            originalMessage: compactResult.originalMessage
        };
    }

    const clearResult = parseClear(message);
    if (clearResult.isClear) {
        return {
            type: 'clear'
        };
    }

    const planResult = parsePlan(message);
    if (planResult.isPlan) {
        return {
            type: 'plan',
            mode: planResult.mode,
            prompt: planResult.prompt,
            originalMessage: stripHapiTitleReminder(message).trim()
        };
    }

    return {
        type: null
    };
}
