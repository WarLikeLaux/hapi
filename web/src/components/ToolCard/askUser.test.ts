import { describe, expect, it } from 'vitest'
import {
    extractAskUserQuestionsInfo,
    extractAskUserSuppression,
    isAskUserToolName,
    parseAskUserInput
} from '@/components/ToolCard/askUser'
import { isAskUserQuestionToolName } from '@/components/ToolCard/askUserQuestion'
import { isCursorAskQuestionToolName } from '@/components/ToolCard/cursorAskQuestion'

describe('askUser parser', () => {
    it('recognises ask_user through both the dedicated and umbrella detectors', () => {
        expect(isAskUserToolName('ask_user')).toBe(true)
        expect(isAskUserQuestionToolName('ask_user')).toBe(true)
        // Does not steal matches from sibling detectors.
        expect(isCursorAskQuestionToolName('ask_user')).toBe(false)
        expect(isAskUserToolName('AskUserQuestion')).toBe(false)
    })

    it('parses the MCP-style {mode, title, steps[]} payload into the AskUserQuestion shape', () => {
        const parsed = parseAskUserInput({
            mode: 'questionnaire',
            title: 'Pick a slot task',
            steps: [
                {
                    id: 'task',
                    header: 'Task',
                    question: 'Which task should I work on in this slot?',
                    description: 'Slot = workspace for one task.',
                    options: [
                        { label: 'Describe in prose', description: 'You follow up with details.' },
                        { label: 'Pick for me', description: 'Browse ready backlog or issues.' }
                    ],
                    multiSelect: false
                },
                {
                    id: 'urgent',
                    header: 'Urgency',
                    question: 'How urgent?',
                    options: [
                        { label: 'Now' },
                        { label: 'This week' },
                        { label: 'Whenever' }
                    ],
                    multiSelect: true
                }
            ]
        })

        expect(parsed.title).toBe('Pick a slot task')
        expect(parsed.questions).toHaveLength(2)

        const [first, second] = parsed.questions
        expect(first).toMatchObject({
            id: 'task',
            header: 'Task',
            question: 'Which task should I work on in this slot?',
            multiSelect: false,
            options: [
                { label: 'Describe in prose', description: 'You follow up with details.' },
                { label: 'Pick for me', description: 'Browse ready backlog or issues.' }
            ]
        })

        expect(second).toMatchObject({
            id: 'urgent',
            header: 'Urgency',
            question: 'How urgent?',
            multiSelect: true,
            options: [
                { label: 'Now', description: null },
                { label: 'This week', description: null },
                { label: 'Whenever', description: null }
            ]
        })
    })

    it('preserves stable question ids so ACP submit keys answers by step.id', () => {
        const parsed = parseAskUserInput({
            mode: 'questionnaire',
            steps: [
                {
                    id: 'plan',
                    question: 'Plan?',
                    options: [{ label: 'Yes' }, { label: 'No' }]
                },
                {
                    id: 'priority',
                    question: 'Priority?',
                    options: [{ label: 'High' }, { label: 'Low' }]
                }
            ]
        })

        const answers: Record<string, string[]> = {}
        for (const q of parsed.questions) {
            answers[q.id!] = q.options.map((o) => o.label)
        }
        expect(answers).toEqual({
            plan: ['Yes', 'No'],
            priority: ['High', 'Low']
        })
    })

    it('falls back to step.id when header is missing, then null', () => {
        const onlyId = parseAskUserInput({
            steps: [
                {
                    id: 'choice',
                    question: 'Pick',
                    options: [{ label: 'a' }]
                }
            ]
        }).questions[0]
        expect(onlyId?.header).toBe('choice')

        const generated = parseAskUserInput({
            steps: [
                {
                    question: 'No id?',
                    options: [{ label: 'a' }]
                }
            ]
        }).questions[0]
        expect(generated?.id).toBeUndefined()
        expect(generated?.header).toBeNull()
    })

    it('skips empty steps and returns an empty list for non-questionnaire payloads', () => {
        expect(parseAskUserInput(null).questions).toEqual([])
        expect(parseAskUserInput({}).questions).toEqual([])
        expect(parseAskUserInput({ mode: 'something-else', steps: [] }).questions).toEqual([])

        const sparse = parseAskUserInput({
            steps: [
                null,
                {},
                { question: '', options: [] },
                { question: 'real', options: [{ label: 'a' }] }
            ]
        })
        expect(sparse.questions).toHaveLength(1)
        expect(sparse.questions[0]?.question).toBe('real')
    })

    it('returns null for invalid input from extractAskUserQuestionsInfo', () => {
        expect(extractAskUserQuestionsInfo(null)).toBeNull()
        expect(extractAskUserQuestionsInfo({})).toBeNull()
        expect(extractAskUserQuestionsInfo({ steps: 'nope' })).toBeNull()

        const infos = extractAskUserQuestionsInfo({
            steps: [
                { id: 'a', header: 'A', question: 'Q1' },
                { question: 'Q2' }
            ]
        })
        expect(infos).toEqual([
            { id: 'a', header: 'A', question: 'Q1' },
            { id: '1', header: null, question: 'Q2' }
        ])
    })
})

describe('askUser suppression detection', () => {
    it('returns null when result is missing or not an object', () => {
        expect(extractAskUserSuppression(undefined)).toBeNull()
        expect(extractAskUserSuppression(null)).toBeNull()
        expect(extractAskUserSuppression('nope')).toBeNull()
        expect(extractAskUserSuppression(42)).toBeNull()
    })

    it('returns null when details are present but suppressed is false', () => {
        expect(extractAskUserSuppression({
            tool_name: 'ask_user',
            details: { suppressed: false, reason: 'still-active', waiting_for_user: true }
        })).toBeNull()
    })

    it('returns null when details are missing and text is unrelated', () => {
        expect(extractAskUserSuppression({
            tool_name: 'ask_user',
            text: 'Questionnaire abc is waiting for the local user.'
        })).toBeNull()
    })

    it('detects details.suppressed and exposes the reason + waiting_for_user flag', () => {
        expect(extractAskUserSuppression({
            tool_name: 'ask_user',
            details: { suppressed: true, reason: 'user-sent-new-instruction', waiting_for_user: false }
        })).toEqual({
            reason: 'user-sent-new-instruction',
            waitingForUser: false
        })
    })

    it('falls back to a generic reason when details.suppressed is true but reason is missing or non-string', () => {
        expect(extractAskUserSuppression({
            tool_name: 'ask_user',
            details: { suppressed: true, waiting_for_user: false }
        })).toEqual({ reason: null, waitingForUser: false })

        expect(extractAskUserSuppression({
            tool_name: 'ask_user',
            details: { suppressed: true, reason: 42, waiting_for_user: false }
        })).toEqual({ reason: null, waitingForUser: false })
    })

    it('matches on the known MiniMax "Question not asked" text when details were dropped', () => {
        expect(extractAskUserSuppression({
            tool_name: 'ask_user',
            text: 'Question not asked: the user already sent a new instruction while this question was being raised. Follow the incoming user message instead.'
        })).toEqual({
            reason: 'user-sent-new-instruction',
            waitingForUser: false
        })
    })
})
