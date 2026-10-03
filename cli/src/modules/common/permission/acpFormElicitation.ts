import { isObject } from '@hapi/protocol';
import type { FormElicitationResponse } from '@/agent/types';

type Content = Extract<FormElicitationResponse, { action: 'accept' }>['content'];
export type FormAnswers = Record<string, string[]> | Record<string, { answers: string[] }>;
type Choice = { value: string; label: string; description: string };
const OTHER = 'None of the above';
const NOTE_PREFIX = 'user_note: ';
type Field = {
    id: string;
    property: Record<string, unknown>;
    choices: Choice[];
    required: boolean;
    otherField?: Field;
};

function choicesFor(property: Record<string, unknown>): Choice[] | null {
    const rawChoices = property.oneOf ?? property.anyOf ?? property.enum;
    if (rawChoices === undefined) return [];
    if (!Array.isArray(rawChoices) || rawChoices.length === 0) return null;
    const choices: Choice[] = [];
    for (const raw of rawChoices) {
        const value = isObject(raw) ? raw.const : raw;
        if (typeof value !== 'string') return null;
        const title = isObject(raw) && typeof raw.title === 'string' ? raw.title.trim() : value.trim();
        choices.push({
            value,
            label: title || value,
            description: isObject(raw) && typeof raw.description === 'string' ? raw.description : ''
        });
    }
    // The existing question UI submits labels. Disambiguate duplicate titles
    // without losing the stable IDs the agent expects in elicitation content.
    const labels = choices.map((choice) => choice.label);
    for (const choice of choices) {
        if (labels.filter((label) => label === choice.label).length > 1) {
            choice.label = `${choice.label} (${choice.value})`;
        }
    }
    if (new Set(choices.map((choice) => choice.label)).size !== choices.length) return null;
    return choices;
}

function valuesFor(answers: FormAnswers | undefined, id: string): string[] {
    const raw = answers?.[id];
    const values = Array.isArray(raw) ? raw : isObject(raw) ? raw.answers : undefined;
    return Array.isArray(values) ? values.filter((value): value is string => typeof value === 'string') : [];
}

function withinBounds(value: number, minimum: unknown, maximum: unknown): boolean {
    return (typeof minimum !== 'number' || value >= minimum)
        && (typeof maximum !== 'number' || value <= maximum);
}

export function parseAcpFormElicitation(params: unknown) {
    if (!isObject(params) || params.mode !== 'form' || !isObject(params.requestedSchema)) return null;
    const schema = params.requestedSchema;
    if (schema.type !== 'object' || !isObject(schema.properties)) return null;
    const required = new Set(Array.isArray(schema.required) ? schema.required : []);
    const fields: Field[] = [];
    for (const [id, property] of Object.entries(schema.properties)) {
        if (!id.trim() || id !== id.trim() || ['__proto__', 'constructor', 'prototype'].includes(id)
            || !isObject(property)) return null;
        if (!['string', 'array', 'boolean', 'number', 'integer'].includes(String(property.type))) return null;
        const choiceSchema = property.type === 'array' ? property.items : property;
        if (!isObject(choiceSchema)) return null;
        const choices = property.type === 'boolean'
            ? [{ value: 'true', label: 'true', description: '' }, { value: 'false', label: 'false', description: '' }]
            : choicesFor(choiceSchema);
        if (!choices || (property.type === 'array' && choices.length === 0)) return null;
        fields.push({ id, property, choices, required: required.has(id) });
    }
    if ([...required].some((id) => !fields.some((field) => field.id === id))) return null;
    // MiniMax represents a question's custom answer as a separate schema property.
    // Match its complete layout so unrelated text fields remain independent.
    const supplementalFields = new Set<Field>();
    for (const field of fields) {
        if (field.choices.length === 0 || !['string', 'array'].includes(String(field.property.type))) continue;
        const prefix = `${field.id}__other`;
        const otherField = fields.find((candidate) => candidate.id.startsWith(prefix)
            && /^_*$/.test(candidate.id.slice(prefix.length))
            && candidate.property.type === 'string' && candidate.choices.length === 0 && !candidate.required
            && typeof field.property.title === 'string'
            && candidate.property.title === `${field.property.title} \u2014 Other`);
        if (!otherField) continue;
        field.otherField = otherField;
        supplementalFields.add(otherField);
        for (const choice of field.choices) {
            if (choice.label === OTHER) choice.label = `${choice.label} (${choice.value})`;
        }
        if (new Set(field.choices.map((choice) => choice.label)).size !== field.choices.length) return null;
    }
    const questions = fields.filter((field) => !supplementalFields.has(field));
    const message = typeof params.message === 'string' ? params.message : 'MiniMax Code needs your input';
    const input = {
        questions: questions.length > 0 ? questions.map(({ id, property, choices, required, otherField }) => ({
            id,
            question: [message, typeof property.title === 'string' ? property.title : id,
                typeof property.description === 'string' ? property.description : ''].filter(Boolean).join('\n\n'),
            required,
            multiple: property.type === 'array',
            ...(otherField ? { isOther: true, otherRequiresText: true } : {}),
            options: choices.map(({ label, description }) => ({ label, description }))
        })) : [{ id: '__acp_confirmation', question: message, options: [{ label: 'Continue', description: '' }] }]
    };

    return {
        input,
        readAnswers(answers: FormAnswers | undefined): Content | null {
            const content: Content = Object.create(null);
            if (fields.length === 0) {
                return valuesFor(answers, '__acp_confirmation').includes('Continue') ? content : null;
            }
            for (const { id, property, choices, required, otherField } of questions) {
                const values = valuesFor(answers, id);
                if (values.length === 0) {
                    if (required) return null;
                    continue;
                }
                if (choices.length > 0) {
                    const notes = values.filter((value) => !choices.some((choice) => choice.label === value)
                        && value.startsWith(NOTE_PREFIX));
                    if (notes.length > 1) return null;
                    const selections = values.filter((value) => !notes.includes(value));
                    if (otherField && selections.includes(OTHER)) {
                        const text = notes[0]?.slice(NOTE_PREFIX.length);
                        if (selections.length !== 1 || !text?.trim()
                            || !withinBounds([...text].length, otherField.property.minLength, otherField.property.maxLength)) return null;
                        content[otherField.id] = text;
                        continue;
                    }
                    const selected = selections.map((value) => choices.find((choice) => choice.label === value)?.value);
                    if (selected.some((value) => value === undefined)) return null;
                    const ids = selected as string[];
                    if (property.type === 'array') {
                        const selectedIds = [...new Set(ids)];
                        if (!withinBounds(selectedIds.length, property.minItems, property.maxItems)) return null;
                        content[id] = selectedIds;
                    }
                    else if (ids.length !== 1) return null;
                    else content[id] = property.type === 'boolean' ? ids[0] === 'true' : ids[0]!;
                } else {
                    if (values.length !== 1 || !values[0]!.startsWith(NOTE_PREFIX)) return null;
                    const text = values[0]!.slice(NOTE_PREFIX.length);
                    if (property.type === 'string') {
                        if (!withinBounds([...text].length, property.minLength, property.maxLength)) return null;
                        content[id] = text;
                    } else {
                        const number = Number(text);
                        if (!text.trim() || !Number.isFinite(number)
                            || (property.type === 'integer' && !Number.isInteger(number))
                            || !withinBounds(number, property.minimum, property.maximum)) return null;
                        content[id] = number;
                    }
                }
            }
            return content;
        }
    };
}
