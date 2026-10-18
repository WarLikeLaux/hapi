import { applyEdits, modify, parse, type ParseError } from 'jsonc-parser';
import { isObject } from '@hapi/protocol';

export function buildOpencodeEnv(): NodeJS.ProcessEnv {
    const content = process.env.OPENCODE_CONFIG_CONTENT || '{}';
    const errors: ParseError[] = [];
    const config: unknown = parse(content, errors, { allowTrailingComma: true });
    if (errors.length > 0 || !isObject(config)) {
        throw new Error('Invalid OPENCODE_CONFIG_CONTENT');
    }
    // OpenCode 1.19.3 omits this variant, but Go accepts max and confirms it
    // in response.completed.reasoning.effort. Scope the addition to this child.
    const edits = modify(content, [
        'provider', 'opencode-go', 'models', 'muse-spark-1.3-contributor',
        'variants', 'max', 'reasoningEffort'
    ], 'max', {});
    return {
        ...process.env,
        OPENCODE_CONFIG_CONTENT: applyEdits(content, edits)
    };
}
