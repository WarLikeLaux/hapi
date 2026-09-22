import { copyFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export function resolveCodexHome(env: NodeJS.ProcessEnv = process.env): string {
    const configuredHome = env.CODEX_HOME?.trim();
    return configuredHome ? configuredHome : join(homedir(), '.codex');
}

export type CodexConfigDefaults = {
    model: string | null;
    modelReasoningEffort: string | null;
};

// Codex resolves a plain session's default model and reasoning effort from the
// top-level keys of config.toml ($CODEX_HOME, usually ~/.codex). Only keys
// before the first [table] header count: everything after belongs to a profile
// or another table and does not set the session default. A missing or unreadable
// config is a valid state — codex then falls back to its own defaults.
export function readCodexConfigDefaults(configHome: string = resolveCodexHome()): CodexConfigDefaults {
    let raw: string;
    try {
        raw = readFileSync(join(configHome, 'config.toml'), 'utf8');
    } catch {
        return { model: null, modelReasoningEffort: null };
    }

    const defaults: CodexConfigDefaults = { model: null, modelReasoningEffort: null };
    for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) {
            continue;
        }
        if (trimmed.startsWith('[')) {
            break;
        }
        const assignment = trimmed.match(/^(model|model_reasoning_effort)\s*=\s*(.+)$/);
        if (!assignment) {
            continue;
        }
        const value = assignment[2].trim().replace(/^["'](.*)["']$/, '$1').trim();
        if (!value) {
            continue;
        }
        if (assignment[1] === 'model') {
            defaults.model = value;
        } else {
            defaults.modelReasoningEffort = value;
        }
    }
    return defaults;
}

/**
 * Copy only Codex's user config into a runner-owned home.
 *
 * Runner-spawned Codex sessions use a temporary CODEX_HOME for token auth.
 * Copying config.toml preserves user MCP settings without copying auth files
 * or unrelated state. A missing source config is a valid first-run state.
 */
export async function copyCodexConfigFile(sourceHome: string, targetHome: string): Promise<string | null> {
    if (resolve(sourceHome) === resolve(targetHome)) {
        return null;
    }

    const targetConfigPath = join(targetHome, 'config.toml');
    try {
        await copyFile(join(sourceHome, 'config.toml'), targetConfigPath);
        return targetConfigPath;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return null;
        }
        throw error;
    }
}
