import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { asString, isCursorAutoModelId, isObject } from '@hapi/protocol';

/** Read only the display hint; launching without --model still lets Cursor resolve its default. */
export function readCursorDefaultModelName(env: NodeJS.ProcessEnv = process.env): string | null {
    const configDir = env.CURSOR_CONFIG_DIR?.trim()
        || (process.platform !== 'win32' && process.platform !== 'darwin' && env.XDG_CONFIG_HOME?.trim()
            ? join(env.XDG_CONFIG_HOME.trim(), 'cursor')
            : join(homedir(), '.cursor'));
    try {
        const config: unknown = JSON.parse(readFileSync(join(configDir, 'cli-config.json'), 'utf8'));
        if (!isObject(config)) return null;
        const model = isObject(config.model) ? config.model : null;
        const selected = isObject(config.selectedModel) ? asString(config.selectedModel.modelId)?.trim() : null;
        const modelId = selected || asString(model?.modelId)?.trim();
        if (!modelId) return null;
        if (isCursorAutoModelId(modelId)) return 'Auto';
        // Never label a newer selectedModel with another model's saved display name.
        const name = !selected || selected === asString(model?.modelId)?.trim()
            ? asString(model?.displayName)?.trim()
            : null;
        return name || modelId;
    } catch {
        // Missing or malformed config must not prevent opening the launch form.
        return null;
    }
}
