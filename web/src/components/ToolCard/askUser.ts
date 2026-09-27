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

/**
 * `ask_user` may return a tool result with `details.suppressed: true` when the
 * agent's local runtime superseded the questionnaire because the user already
 * sent a new instruction while the question was being raised. In that case
 * `details.waiting_for_user` is `false` and the tool text reads
 *   "Question not asked: the user already sent a new instruction while this
 *    question was being raised. Follow the incoming user message instead."
 *
 * The runtime still emits the original questions in `tool.input`, so the UI
 * can recover them and offer an "answer anyway" steer instead of silently
 * dropping them.
 */
export type AskUserSuppressionInfo = {
    reason: string | null
    /** Echo of MiniMax's `details.waiting_for_user`; always false when suppressed. */
    waitingForUser: boolean
}

export function extractAskUserSuppression(result: unknown): AskUserSuppressionInfo | null {
    if (!isObject(result)) return null

    const details = isObject(result.details) ? result.details : null
    if (details && details.suppressed === true) {
        const reason = typeof details.reason === 'string' && details.reason.trim()
            ? details.reason.trim()
            : null
        const waitingForUser = details.waiting_for_user === true
        return { reason, waitingForUser }
    }

    // Fallback: some ACP transports only put the tool text under `text` and drop
    // `details`. Match on the known MiniMax text so the UI still surfaces the
    // skip instead of pretending the question was answered.
    const text = typeof result.text === 'string' ? result.text : ''
    if (text.startsWith('Question not asked:')) {
        return { reason: 'user-sent-new-instruction', waitingForUser: false }
    }

    return null
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
