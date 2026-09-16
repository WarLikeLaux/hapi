import { SKILL_LOOKUP_INSTRUCTION } from '@/modules/common/skillLookupInstruction'
import { withSessionSummaryInstruction } from '@/modules/common/sessionSummaryInstruction'
import { buildSessionTitleMcpInstructions } from '@/modules/common/sessionTitlePrompt'

export const GROK_TITLE_INSTRUCTION =
    `${buildSessionTitleMcpInstructions('hapi_change_title')}\n${SKILL_LOOKUP_INSTRUCTION}`

export function getGrokTitleInstruction(env: NodeJS.ProcessEnv = process.env): string {
    return withSessionSummaryInstruction(GROK_TITLE_INSTRUCTION, env)
}
