import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { ensureAgyHapiMcpConfig, ensureAgyHapiTitlePermission } from './agyHapiMcpConfig'

const temporaryDirectories: string[] = []

afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function temporaryConfigPath(): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), 'hapi-agy-mcp-'))
    temporaryDirectories.push(directory)
    return join(directory, 'config', 'mcp_config.json')
}

describe('ensureAgyHapiMcpConfig', () => {
    it('preserves user servers and installs a session-routed HAPI bridge', async () => {
        const path = await temporaryConfigPath()
        await mkdir(dirname(path), { recursive: true })
        await writeFile(path, JSON.stringify({
            custom: true,
            mcpServers: { existing: { command: 'existing-mcp' } },
        }))

        await expect(ensureAgyHapiMcpConfig({
            command: '/opt/hapi',
            args: ['mcp', '--tools', 'change_title'],
        }, path)).resolves.toBe(true)

        const config = JSON.parse(await readFile(path, 'utf8'))
        expect(config.custom).toBe(true)
        expect(config.mcpServers.existing).toEqual({ command: 'existing-mcp' })
        expect(config.mcpServers['hapi-session']).toEqual({
            command: '/opt/hapi',
            args: ['mcp', '--tools', 'change_title'],
            env: { HAPI_MANAGED_SESSION_BRIDGE: '1' },
        })
        await expect(ensureAgyHapiMcpConfig({
            command: '/opt/hapi',
            args: ['mcp', '--tools', 'change_title'],
        }, path)).resolves.toBe(false)
    })

    it('does not overwrite malformed user configuration', async () => {
        const path = await temporaryConfigPath()
        await mkdir(dirname(path), { recursive: true })
        await writeFile(path, '{ broken json')

        await expect(ensureAgyHapiMcpConfig({ command: 'hapi', args: ['mcp'] }, path)).rejects.toThrow()
        await expect(readFile(path, 'utf8')).resolves.toBe('{ broken json')
    })

    it('does not overwrite a user-managed server with the reserved name', async () => {
        const path = await temporaryConfigPath()
        await mkdir(dirname(path), { recursive: true })
        const original = JSON.stringify({
            mcpServers: { 'hapi-session': { command: 'my-custom-server' } },
        })
        await writeFile(path, original)

        await expect(ensureAgyHapiMcpConfig({ command: 'hapi', args: ['mcp'] }, path))
            .rejects.toThrow('already user-managed')
        await expect(readFile(path, 'utf8')).resolves.toBe(original)
    })

    it('adopts a legacy unmarked entry that points at our own bridge binary', async () => {
        // Versions before the HAPI_MANAGED_SESSION_BRIDGE marker wrote the
        // entry without env; treating those as user-managed made every later
        // agy session drop the bridge (and with it all HAPI MCP tools).
        const path = await temporaryConfigPath()
        await mkdir(dirname(path), { recursive: true })
        await writeFile(path, JSON.stringify({
            mcpServers: {
                'hapi-session': {
                    command: '/opt/hapi',
                    args: ['mcp', '--tools', 'change_title'],
                },
            },
        }))

        await expect(ensureAgyHapiMcpConfig({
            command: '/opt/hapi',
            args: ['mcp', '--tools', 'change_title,display_media'],
        }, path)).resolves.toBe(true)

        const config = JSON.parse(await readFile(path, 'utf8'))
        expect(config.mcpServers['hapi-session']).toEqual({
            command: '/opt/hapi',
            args: ['mcp', '--tools', 'change_title,display_media'],
            env: { HAPI_MANAGED_SESSION_BRIDGE: '1' },
        })
    })

    it('still refuses an unmarked reserved entry whose command is not ours', async () => {
        const path = await temporaryConfigPath()
        await mkdir(dirname(path), { recursive: true })
        const original = JSON.stringify({
            mcpServers: { 'hapi-session': { command: 'my-custom-server' } },
        })
        await writeFile(path, original)

        await expect(ensureAgyHapiMcpConfig({ command: 'hapi', args: ['mcp'] }, path))
            .rejects.toThrow('already user-managed')
    })

    it('preserves permissions and auto-allows only the HAPI title tool', async () => {
        const path = await temporaryConfigPath()
        await mkdir(dirname(path), { recursive: true })
        await writeFile(path, JSON.stringify({
            colorScheme: 'dark',
            permissions: { allow: ['command(git status)'], deny: ['command(rm)'] },
        }))

        await expect(ensureAgyHapiTitlePermission(path)).resolves.toBe(true)
        const settings = JSON.parse(await readFile(path, 'utf8'))
        expect(settings).toEqual({
            colorScheme: 'dark',
            permissions: {
                allow: ['command(git status)', 'mcp(hapi-session/change_title)'],
                deny: ['command(rm)'],
            },
        })
        await expect(ensureAgyHapiTitlePermission(path)).resolves.toBe(false)
    })
})
