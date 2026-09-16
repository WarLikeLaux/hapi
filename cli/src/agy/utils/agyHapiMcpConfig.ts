import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import type { HappyCliCommand } from '@/utils/spawnHappyCLI'

const HAPI_MCP_SERVER_NAME = 'hapi-session'
const HAPI_TITLE_PERMISSION = `mcp(${HAPI_MCP_SERVER_NAME}/change_title)`
const HAPI_MANAGED_ENV = 'HAPI_MANAGED_SESSION_BRIDGE'

type JsonRecord = Record<string, unknown>

function asRecord(value: unknown): JsonRecord | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as JsonRecord
        : null
}

export function agyHapiMcpConfigPath(): string {
    return join(homedir(), '.gemini', 'config', 'mcp_config.json')
}

export function agySettingsPath(): string {
    return join(homedir(), '.gemini', 'antigravity-cli', 'settings.json')
}

async function readJsonObject(path: string, label: string): Promise<JsonRecord> {
    try {
        const record = asRecord(JSON.parse(await readFile(path, 'utf8')) as unknown)
        if (!record) throw new Error(`${label} root must be an object`)
        return record
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
        throw error
    }
}

async function writeJsonAtomic(path: string, value: JsonRecord): Promise<void> {
    await mkdir(dirname(path), { recursive: true })
    const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    try {
        await rename(temporaryPath, path)
    } catch (error) {
        await unlink(temporaryPath).catch(() => {})
        throw error
    }
}

/**
 * Install one process-independent HAPI MCP entry for Antigravity. The bridge
 * URL is intentionally absent: every `agy` child inherits the current
 * session's HAPI_HTTP_MCP_URL, so concurrent HAPI sessions all use the same
 * persistent config without being able to rename one another.
 */
export async function ensureAgyHapiMcpConfig(
    command: HappyCliCommand,
    configPath = agyHapiMcpConfigPath()
): Promise<boolean> {
    const root = await readJsonObject(configPath, 'Antigravity MCP config')

    const existingServers = asRecord(root.mcpServers) ?? {}
    const existing = asRecord(existingServers[HAPI_MCP_SERVER_NAME])
    const existingEnv = asRecord(existing?.env)
    if (existing && existingEnv?.[HAPI_MANAGED_ENV] !== '1') {
        throw new Error(`Antigravity MCP server name "${HAPI_MCP_SERVER_NAME}" is already user-managed`)
    }
    const desired = {
        command: command.command,
        args: command.args,
        env: { [HAPI_MANAGED_ENV]: '1' },
    }
    if (JSON.stringify(existingServers[HAPI_MCP_SERVER_NAME]) === JSON.stringify(desired)) {
        return false
    }

    const next = {
        ...root,
        mcpServers: {
            ...existingServers,
            [HAPI_MCP_SERVER_NAME]: desired,
        },
    }
    await writeJsonAtomic(configPath, next)
    return true
}

/** Auto-approve only the harmless session-title tool in request-review mode. */
export async function ensureAgyHapiTitlePermission(
    settingsPath = agySettingsPath()
): Promise<boolean> {
    const root = await readJsonObject(settingsPath, 'Antigravity settings')
    const permissions = asRecord(root.permissions) ?? {}
    const existingAllow = permissions.allow
    if (existingAllow !== undefined && !Array.isArray(existingAllow)) {
        throw new Error('Antigravity settings permissions.allow must be an array')
    }
    const allow = existingAllow ?? []
    if (allow.includes(HAPI_TITLE_PERMISSION)) return false

    await writeJsonAtomic(settingsPath, {
        ...root,
        permissions: {
            ...permissions,
            allow: [...allow, HAPI_TITLE_PERMISSION],
        },
    })
    return true
}
