/**
 * Codex-specific system prompt for local mode.
 *
 * This prompt instructs Codex to call the hapi__change_title function
 * to set appropriate chat session titles.
 */

import { trimIdent } from '@/utils/trimIdent';
import { buildSessionCitationSteerInstruction } from '@hapi/protocol/sessionCitation';
import { DISPLAY_IMAGE_PROMPT_CODEX, DISPLAY_MEDIA_PROMPT_CODEX, DISPLAY_VIDEO_PROMPT_CODEX } from '@/modules/common/displayImagePrompt';
import { withSessionSummaryInstruction } from '@/modules/common/sessionSummaryInstruction';

/**
 * Title instruction for Codex to call the hapi MCP tool.
 * Note: Codex exposes MCP tools under the `functions.` namespace,
 * so the tool is called as `functions.hapi__change_title`.
 */
export const TITLE_INSTRUCTION = trimIdent(`
    Keep the chat title aligned with the user's current primary objective. Reassess it on every user turn, including in long-running chats, and call the title tool when the primary objective has materially changed or the existing title is vague or misleading.
    For a new chat, call the title tool after the user's initial request is clear. A title set manually by the user is not locked and may be replaced when a clearer current-task title is available.
    Write titles in Russian. Make each title specific and understandable without opening the chat, preferably 3-7 words. Do not include task or ticket IDs, Git branch names, commit hashes, machine names, or bare repository names.
    Prefer calling functions.hapi__change_title.
    If that exact tool name is unavailable, call an equivalent alias such as hapi__change_title, mcp__hapi__change_title, or hapi_change_title.
    Do not rename for routine progress, substeps, or minor wording improvements when the current title remains accurate.
    ${DISPLAY_IMAGE_PROMPT_CODEX}
    ${DISPLAY_VIDEO_PROMPT_CODEX}
    ${DISPLAY_MEDIA_PROMPT_CODEX}
    ${buildSessionCitationSteerInstruction({
        inspectTool: 'functions.hapi__inspect_peer',
        pingTool: 'functions.hapi__ping_peer',
        listPeersTool: 'functions.hapi__list_peers',
    })}
`);

/**
 * The system prompt to inject via developer_instructions in local mode.
 * Session-summary contract is resolved at call time (hub toggle / env).
 *
 * The per-turn reminder that used to live here moved to ApiSession.enqueueUserMessage
 * so every flavor gets it for free. The shared helper is
 * `buildSessionTitleTurnReminder` from `@/modules/common/sessionTitlePrompt`.
 */
export function getCodexSystemPrompt(env: NodeJS.ProcessEnv = process.env): string {
    return withSessionSummaryInstruction(TITLE_INSTRUCTION, env)
}

/** Alias kept for existing call sites / tests that expect a string constant name. */
export const codexSystemPrompt = TITLE_INSTRUCTION
