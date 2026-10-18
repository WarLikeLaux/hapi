import { act, createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ApiClient } from '@/api/client'
import type { ChatToolCall } from '@/chat/types'
import { AskUserQuestionFooter } from './AskUserQuestionFooter'
import { RequestUserInputFooter } from './RequestUserInputFooter'

vi.mock('@/hooks/usePlatform', () => ({
    usePlatform: () => ({ haptic: { notification: vi.fn(), selection: vi.fn() } })
}))
vi.mock('@/lib/use-translation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

const question = { id: 'q', question: 'Details?', options: [{ label: 'Alpha' }] }
type KeyboardCase = {
    name: string
    input: unknown
    other: boolean
    answers: Record<string, string[] | { answers: string[] }>
}

const cases: KeyboardCase[] = [
    { name: 'AskUserQuestion', input: {}, other: false, answers: { '0': ['Details'] } },
    ...['AskUserQuestion', 'ask_user_question', 'CursorAskQuestion', 'ask_user'].map((name) => ({
        name, input: name === 'ask_user' ? { steps: [question] } : { questions: [question] }, other: true,
        answers: { [name === 'ask_user' || name === 'CursorAskQuestion' ? 'q' : '0']: ['Details'] }
    })),
    ...['request_user_input', 'request_user_input_async'].flatMap((name) => [
        { name, input: { questions: [{ ...question, options: [] }] }, other: false,
            answers: { q: { answers: ['user_note: Details'] } } },
        { name, input: { questions: [{ ...question, isOther: true, otherRequiresText: true }] }, other: true,
            answers: { q: { answers: ['None of the above', 'user_note: Details'] } } }
    ])
]

function setup(testCase: KeyboardCase, disabled = false) {
    const approvePermission = vi.fn().mockResolvedValue(undefined)
    const answerCodexAsyncQuestion = vi.fn().mockResolvedValue(undefined)
    const isRequest = testCase.name.startsWith('request_user_input')
    const Component = isRequest ? RequestUserInputFooter : AskUserQuestionFooter
    const tool = { id: crypto.randomUUID(), name: testCase.name, input: testCase.input,
        state: 'pending', result: null, permission: { id: 'permission', status: 'pending' } } as ChatToolCall
    render(<Component api={{ approvePermission, answerCodexAsyncQuestion } as unknown as ApiClient}
        sessionId="keyboard" tool={tool} disabled={disabled} onDone={vi.fn()} />)
    if (testCase.other) fireEvent.click(screen.getByRole(isRequest ? 'button' : 'radio', {
        name: isRequest ? /tool.requestUserInput.otherLabel/ : /tool.other/,
    }))
    return { api: testCase.name.endsWith('_async') ? answerCodexAsyncQuestion : approvePermission, tool }
}

// The rendered production footers own this contract: every supported text answer
// must reach its existing API with the same validation and payload as Submit.
describe('question answer keyboard', () => {
    it.each(cases)('sends $name (Other=$other) with Enter, rejects blank text and ignores composition/Shift', async (testCase) => {
        const { api, tool } = setup(testCase)
        const field = screen.getByRole('textbox')
        fireEvent.change(field, { target: { value: '   ' } })
        fireEvent.keyDown(field, { key: 'Enter' })
        expect(api).not.toHaveBeenCalled()
        fireEvent.change(field, { target: { value: 'Details' } })
        for (const extra of [{ shiftKey: true }, { isComposing: true }, { keyCode: 229 }]) {
            const event = createEvent.keyDown(field, { key: 'Enter', cancelable: true, ...extra })
            fireEvent(field, event)
            expect(event.defaultPrevented).toBe(false)
            expect(api).not.toHaveBeenCalled()
        }
        const enter = createEvent.keyDown(field, { key: 'Enter', cancelable: true })
        fireEvent(field, enter)
        expect(enter.defaultPrevented).toBe(true)
        const payload = testCase.name.endsWith('_async') ? testCase.answers : { answers: testCase.answers }
        await waitFor(() => expect(api).toHaveBeenCalledWith('keyboard', testCase.name.endsWith('_async') ? tool.id : 'permission', payload))
    })

    it.each([cases[0], cases[5], cases[7]])('blocks concurrent Enter/click and allows retry after failure ($name)', async (testCase) => {
        const { api } = setup(testCase)
        let reject!: (error: Error) => void
        api.mockImplementationOnce(() => new Promise((_, rejectRequest) => { reject = rejectRequest }))
        const field = screen.getByRole('textbox')
        fireEvent.change(field, { target: { value: 'Details' } })
        act(() => {
            fireEvent.keyDown(field, { key: 'Enter' })
            fireEvent.click(screen.getByRole('button', { name: 'tool.submit' }))
            fireEvent.keyDown(field, { key: 'Enter' })
        })
        expect(api).toHaveBeenCalledTimes(1)
        await act(async () => reject(new Error('retry')))
        expect(field).toHaveValue('Details')
        fireEvent.keyDown(field, { key: 'Enter' })
        await waitFor(() => expect(api).toHaveBeenCalledTimes(2))
    })

    it.each(['AskUserQuestion', 'request_user_input'])('requires all answers before sending %s', (name) => {
        const input = { questions: [{ ...question, options: [] }, { ...question, id: 'second', question: 'Second?', options: [] }] }
        const { api } = setup({ ...cases[0], name, input })
        if (name === 'AskUserQuestion') fireEvent.click(screen.getByRole('radio', { name: /tool.other/ }))
        fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Details' } })
        fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })
        expect(api).not.toHaveBeenCalled()
        expect(screen.getByText('Second?')).toBeInTheDocument()
    })

    it.each([false, true])('sends a selected choice with optional notes (Other=%s)', async (other) => {
        const { api } = setup({ ...cases[5], input: { questions: [{ ...question, isOther: true }] } })
        const field = screen.getByRole('textbox')
        fireEvent.change(field, { target: { value: 'Details' } })
        fireEvent.keyDown(field, { key: 'Enter' })
        expect(api).not.toHaveBeenCalled() // Notes alone cannot answer a required choice.
        fireEvent.click(screen.getByRole('button', { name: other ? /tool.requestUserInput.otherLabel/ : /Alpha/ }))
        fireEvent.keyDown(field, { key: 'Enter' })
        await waitFor(() => expect(api).toHaveBeenCalledWith('keyboard', 'permission', {
            answers: { q: { answers: [other ? 'None of the above' : 'Alpha', 'user_note: Details'] } }
        }))
    })

    it('preserves whitespace and newlines in an editor answer', async () => {
        const { api } = setup({ ...cases[5], input: { questions: [{ ...question, options: [], inputType: 'editor' }] } })
        fireEvent.change(screen.getByRole('textbox'), { target: { value: '  first\nsecond  ' } })
        fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })
        await waitFor(() => expect(api).toHaveBeenCalledWith('keyboard', 'permission', {
            answers: { q: { answers: ['user_note:   first\nsecond  '] } }
        }))
    })

    it.each([cases[0], cases[5]])('respects disabled state ($name)', (testCase) => {
        const { api } = setup(testCase, true)
        fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Details' } })
        fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })
        expect(api).not.toHaveBeenCalled()
    })
})
