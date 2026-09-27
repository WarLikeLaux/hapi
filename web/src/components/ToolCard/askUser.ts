import { isObject } from '@hapi/protocol'
import type { AskUserQuestionQuestion } from '@/components/ToolCard/askUserQuestion'

/**
 * Adapter for MiniMax Code's `ask_user` tool.
 *
 * `ask_user` arrives with a different shape than Claude Code's
 * `AskUserQuestion` / `ask_user_question`:
 *
 *     {
 *       "mode": "questionnaire",
 *       "title": "Overall title",
 *       "steps": [
 *         {
 *           "id": "task",
 *           "header": "Short header",
 *           "question": "Full question?",
 *           "description": "Optional context",
 *           "options": [{ "label": "...", "description": "..." }],
 *           "multiSelect": false
 *         }
 *       ]
 *     }
 *
 * The footer/view both consume the AskUserQuestion shape, so this parser
 * converts one into the other. Stable question ids from `step.id` are
 * preserved so ACP-style submit uses the same identifiers the agent emitted.
 */

export function isAskUserToolName(toolName: string): boolean {
    return toolName === 'ask_user'
}

export function parseAskUserInput(input: unknown): { title: string | null; questions: AskUserQuestionQuestion[] } {
    if (!isObject(input)) return { title: null, questions: [] }

    const rawSteps = Array.isArray(input.steps) ? input.steps : null
    const rawTitle = typeof input.title === 'string' ? input.title.trim() : ''
    const title = rawTitle.length > 0 ? rawTitle : null

    if (!rawSteps) return { title, questions: [] }

    const questions: AskUserQuestionQuestion[] = []
    for (const raw of rawSteps) {
        if (!isObject(raw)) continue

        const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : undefined
        const question = typeof raw.question === 'string' ? raw.question.trim() : ''
        const inlineHeader = typeof raw.header === 'string' ? raw.header.trim() : ''
        const header = inlineHeader.length > 0 ? inlineHeader : (id ?? null)
        const multiSelect = raw.multiSelect === true

        const rawOptions = Array.isArray(raw.options) ? raw.options : []
        const options: AskUserQuestionQuestion['options'] = []
        for (const opt of rawOptions) {
            if (!isObject(opt)) continue
            const label = typeof opt.label === 'string' ? opt.label.trim() : ''
            if (!label) continue
            const description = typeof opt.description === 'string' ? opt.description.trim() : null
            // ask_user options have no stable id; mirror Claude's nullable id so
            // the Footer can fall back to the label when stableIds mode is used.
            options.push({ label, description })
        }

        if (!question && options.length === 0) continue

        questions.push({
            ...(id ? { id } : {}),
            header,
            question,
            options,
            multiSelect
        })
    }

    return { title, questions }
}

export type AskUserQuestionInfo = {
    id: string
    header: string | null
    question: string | null
}

/**
 * Lightweight probe used by knownTools.tsx to render the tool card title /
 * subtitle without the heavier parse cost.
 */
export function extractAskUserQuestionsInfo(input: unknown): AskUserQuestionInfo[] | null {
    if (!isObject(input)) return null
    const raw = Array.isArray(input.steps) ? input.steps : null
    if (!raw) return null

    const infos: AskUserQuestionInfo[] = []
    let fallback = 0
    for (const step of raw) {
        if (!isObject(step)) continue
        const id = typeof step.id === 'string' && step.id.trim() ? step.id.trim() : String(fallback)
        fallback += 1
        const header = typeof step.header === 'string' ? step.header.trim() : ''
        const question = typeof step.question === 'string' ? step.question.trim() : ''
        infos.push({
            id,
            header: header.length > 0 ? header : null,
            question: question.length > 0 ? question : null
        })
    }
    return infos
}
