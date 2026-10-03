import { z } from 'zod';
import { AnswerCodexAsyncQuestionRequestSchema, type AnswerCodexAsyncQuestionRequest } from '@hapi/protocol';
import { record, string } from './gateway';

const QuestionsSchema = z.array(z.object({ title: z.string().trim().min(1), options: z.array(z.string().min(1)).nullish() })).min(1);
const ANSWER_PREFIX = 'Answers to Codex questions:\n';

export function asyncQuestionForItem(threadId: string, item: unknown) {
    const value = record(item);
    const parsed = QuestionsSchema.safeParse(value.questions);
    const itemId = string(value.id);
    if (value.type !== 'agentMessage' || value.delivery !== 'async' || !itemId || !parsed.success) return;
    return {
        id: `codex-async-question:${threadId}:${itemId}`,
        questions: parsed.data.map((question, index) => ({
            id: String(index), question: question.title, isOther: true,
            options: (question.options ?? []).map(label => ({ label }))
        }))
    };
}

export function asyncQuestionAnswerId(questionId: string): string {
    return `${questionId}:answer`;
}

export function asyncQuestionAnswerText(request: AnswerCodexAsyncQuestionRequest, questions: Array<{ id: string; question: string }>): string {
    const display = questions.map(question => {
        const answers = request.answers[question.id].answers.map(answer => answer.startsWith('user_note: ') ? answer.slice('user_note: '.length) : answer);
        return `${question.question}\n${answers.join('\n')}`;
    }).join('\n\n');
    // A compact receipt links native history to the card. HAPI displays the prose below it.
    return `${ANSWER_PREFIX}${JSON.stringify(request)}\n\n${display}`;
}

export function parseAsyncQuestionAnswer(text: string): AnswerCodexAsyncQuestionRequest | undefined {
    if (!text.startsWith(ANSWER_PREFIX)) return;
    try {
        const parsed = AnswerCodexAsyncQuestionRequestSchema.safeParse(JSON.parse(text.slice(ANSWER_PREFIX.length).split('\n')[0]));
        return parsed.success ? parsed.data : undefined;
    } catch { return; }
}

export function asyncQuestionAnswerDisplay(text: string): string {
    const separator = text.indexOf('\n\n');
    return separator >= 0 && parseAsyncQuestionAnswer(text) ? text.slice(separator + 2) : text;
}
