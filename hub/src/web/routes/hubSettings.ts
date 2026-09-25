import { Hono } from 'hono'
import {
    applyClaudeGlmBranding,
    UpdateHubSettingsRequestSchema,
    UpdateWorkspacePinsRequestSchema,
    type HubSettingsResponse,
    type WorkspacePin
} from '@hapi/protocol'
import {
    getSettingsFile,
    readSettingsOrThrow,
    updateSettings,
    type Settings
} from '../../config/settings'
import type { WebAppEnv } from '../middleware/auth'

const OWNER_ONLY_ERROR = 'Hub settings are only available to the hub owner'

function normalizeContextOverrides(
    raw: Settings['sessionContextOverrides'] | Settings['projectContextOverrides']
): Record<string, 'work' | 'lab' | 'chill'> {
    if (!raw || typeof raw !== 'object') return {}
    const out: Record<string, 'work' | 'lab' | 'chill'> = {}
    for (const [key, value] of Object.entries(raw)) {
        if (!key || (value !== 'work' && value !== 'lab' && value !== 'chill')) continue
        out[key] = value
        if (Object.keys(out).length >= 500) break
    }
    return out
}

function toHubSettings(settings: Settings): HubSettingsResponse {
    return {
        sessionSummaryContract: settings.sessionSummaryContract === true,
        sessionSummaryInChat: settings.sessionSummaryInChat === true,
        claudeBrandedAsGlm: settings.claudeBrandedAsGlm === true,
        workContextAliases: Array.isArray(settings.workContextAliases) ? settings.workContextAliases : [],
        sessionContextOverrides: normalizeContextOverrides(settings.sessionContextOverrides),
        projectContextOverrides: normalizeContextOverrides(settings.projectContextOverrides),
    }
}

export function createHubSettingsRoutes(dataDir: string): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    // Hub-side branding: notifications resolve agent names through
    // `getFlavorLabel`, so keep the in-process override in sync with the
    // persisted setting — at boot and after every owner update.
    void readSettingsOrThrow(getSettingsFile(dataDir))
        .then((settings) => applyClaudeGlmBranding(settings.claudeBrandedAsGlm === true))
        .catch(() => applyClaudeGlmBranding(false))

    // Authenticated readers (any namespace) can observe hub-wide display/emit
    // flags. Mutations stay owner-only below.
    app.get('/hub-settings', async (c) => {
        c.header('Cache-Control', 'no-store')
        const settings = await readSettingsOrThrow(getSettingsFile(dataDir))
        return c.json(toHubSettings(settings))
    })

    app.put('/hub-settings', async (c) => {
        if (c.get('namespace') !== 'default') {
            return c.json({ error: OWNER_ONLY_ERROR }, 403)
        }
        const json = await c.req.json().catch(() => null)
        const parsed = UpdateHubSettingsRequestSchema.safeParse(json)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }
        const response = await updateSettings(getSettingsFile(dataDir), (current) => {
            const settings: Settings = { ...current }
            if (parsed.data.sessionSummaryContract !== undefined) {
                settings.sessionSummaryContract = parsed.data.sessionSummaryContract
            }
            if (parsed.data.sessionSummaryInChat !== undefined) {
                settings.sessionSummaryInChat = parsed.data.sessionSummaryInChat
            }
            if (parsed.data.claudeBrandedAsGlm !== undefined) {
                settings.claudeBrandedAsGlm = parsed.data.claudeBrandedAsGlm
            }
            if (parsed.data.workContextAliases !== undefined) {
                settings.workContextAliases = parsed.data.workContextAliases
            }
            if (parsed.data.sessionContextOverrides !== undefined) {
                settings.sessionContextOverrides = normalizeContextOverrides(parsed.data.sessionContextOverrides)
            }
            if (parsed.data.projectContextOverrides !== undefined) {
                settings.projectContextOverrides = normalizeContextOverrides(parsed.data.projectContextOverrides)
            }
            return {
                settings,
                result: toHubSettings(settings),
                afterCommit: () => applyClaudeGlmBranding(settings.claudeBrandedAsGlm === true)
            }
        })
        c.header('Cache-Control', 'no-store')
        return c.json(response)
    })

    app.get('/workspace-pins', async (c) => {
        if (c.get('namespace') !== 'default') {
            return c.json({ error: OWNER_ONLY_ERROR }, 403)
        }
        c.header('Cache-Control', 'no-store')
        const settings = await readSettingsOrThrow(getSettingsFile(dataDir))
        return c.json({ pins: settings.workspacePins ?? [] })
    })

    app.put('/workspace-pins', async (c) => {
        if (c.get('namespace') !== 'default') {
            return c.json({ error: OWNER_ONLY_ERROR }, 403)
        }
        const json = await c.req.json().catch(() => null)
        const parsed = UpdateWorkspacePinsRequestSchema.safeParse(json)
        if (!parsed.success || parsed.data.pins.length > 200) {
            return c.json({ error: 'Invalid body' }, 400)
        }
        const pins = Array.from(new Map(parsed.data.pins.map((pin) => [
            `${pin.machineId}\u0000${pin.path}`,
            pin
        ])).values()) as WorkspacePin[]
        const response = await updateSettings(getSettingsFile(dataDir), (current) => ({
            settings: { ...current, workspacePins: pins },
            result: { pins }
        }))
        c.header('Cache-Control', 'no-store')
        return c.json(response)
    })

    return app
}
