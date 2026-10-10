import { existsSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import * as codexExecutable from '@/codex/utils/codexExecutable'
import { executableCandidates, getAgentLaunchCommand, resolveExecutable } from './agentLaunchCommand'
import { getAgentAvailability, getAgentAvailabilityResponse } from './agentAvailability'

async function makeExecutable(directory: string, name: string): Promise<string> {
    const path = join(directory, name)
    await writeFile(path, '#!/bin/sh\nexit 0\n')
    await chmod(path, 0o755)
    return path
}

describe('agent executable resolution', () => {
    it('resolves commands from PATH and absolute environment overrides', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'hapi-agent-path-'))
        const copilot = await makeExecutable(directory, 'copilot-custom')

        expect(resolveExecutable('copilot-custom', { pathValue: directory })).toBe(copilot)
        expect(getAgentLaunchCommand('copilot', { COPILOT_CLI_PATH: copilot })).toBe(copilot)
        expect(getAgentAvailability('copilot', {
            COPILOT_CLI_PATH: copilot,
            PATH: directory,
        })).toEqual({ agent: 'copilot', available: true })
    })

    it.each([
        { agent: 'cursor' as const, command: 'agent', path: 'cli-config.json',
            first: '{"model":{"modelId":"composer-2.5","displayName":"Composer 2.5"}}', name: 'Composer 2.5',
            second: '{"model":{"modelId":"grok-4.7","displayName":"Grok 4.7"}}', nextName: 'Grok 4.7' },
        { agent: 'agy' as const, command: 'agy', path: '.gemini/antigravity-cli/settings.json',
            first: '{"model":"Gemini 3.7 Flash (Medium)"}', name: 'Gemini 3.7 Flash (Medium)',
            second: '{"model":"gemini-3.8-flash-low"}', nextName: 'Gemini 3.8 Flash (Low)' },
        { agent: 'minimax' as const, command: 'mcode', path: 'config.yaml',
            first: 'defaultModel: minimax/MiniMax-M3.1-Flash-Preview\nprovider:\n  minimax:\n    name: MiniMax\n    models:\n      MiniMax-M3.1-Flash-Preview:\n        name: M3.1-Flash-Preview', name: 'MiniMax M3.1-Flash-Preview',
            second: 'defaultModel: minimax/MiniMax-M3', nextName: 'minimax/MiniMax-M3' },
        { agent: 'opencode' as const, command: 'opencode', path: '.config/opencode/opencode.jsonc',
            first: '{ // Native default\n"model": "opencode-go/muse-spark-1.3-contributor",\n}', name: 'opencode-go/muse-spark-1.3-contributor',
            second: '{"model":"openai/gpt-5.4"}', nextName: 'openai/gpt-5.4' }
    ])('reports the configured $agent default without a subprocess and rereads config changes', async (entry) => {
        const directory = await mkdtemp(join(tmpdir(), 'hapi-native-default-'))
        try {
            const executable = join(directory, entry.command)
            await writeFile(executable, '#!/bin/sh\n: > "$0.spawned"\nexit 1\n')
            await chmod(executable, 0o755)
            const env = { PATH: directory, HOME: directory, USERPROFILE: directory, CURSOR_CONFIG_DIR: directory, MINIMAX_DATA_DIR: directory }
            const config = join(directory, entry.path)
            await mkdir(dirname(config), { recursive: true })
            await writeFile(config, entry.first)
            const available = () => getAgentAvailabilityResponse(env).agents.find((agent) => agent.agent === entry.agent)
            expect(available()).toEqual({ agent: entry.agent, available: true, defaultModelName: entry.name })
            await writeFile(config, entry.second)
            expect(available()?.defaultModelName).toBe(entry.nextName)
            await writeFile(config, '{broken json')
            expect(available()).toEqual({ agent: entry.agent, available: true })
            expect(existsSync(`${executable}.spawned`)).toBe(false)
        } finally {
            await rm(directory, { recursive: true, force: true })
        }
    })

    it('resolves OpenCode config overrides without losing the XDG default for configs without a model', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'hapi-opencode-default-'))
        try {
            await makeExecutable(directory, 'opencode')
            const xdgHome = join(directory, 'xdg')
            await mkdir(join(xdgHome, 'opencode'), { recursive: true })
            await writeFile(join(xdgHome, 'opencode', 'opencode.json'), '{"model":"provider/global"}')
            await writeFile(join(xdgHome, 'opencode', 'opencode.jsonc'), '{"model":"provider/jsonc"}')
            const override = join(directory, 'override.json')
            await writeFile(override, '{"model":"provider/custom"}')
            const customDirectory = join(directory, 'custom')
            await mkdir(customDirectory)
            await writeFile(join(customDirectory, 'opencode.json'), '{"model":"provider/directory"}')
            const env = { PATH: directory, HOME: directory, USERPROFILE: directory, XDG_CONFIG_HOME: xdgHome }
            const modelName = (overrides = {}) => getAgentAvailabilityResponse({ ...env, ...overrides })
                .agents.find((entry) => entry.agent === 'opencode')?.defaultModelName
            expect(modelName()).toBe('provider/jsonc')
            expect(modelName({ OPENCODE_CONFIG: override })).toBe('provider/custom')
            expect(modelName({ OPENCODE_CONFIG: override, OPENCODE_CONFIG_DIR: customDirectory })).toBe('provider/directory')
            expect(modelName({ OPENCODE_CONFIG: override, OPENCODE_CONFIG_DIR: customDirectory,
                OPENCODE_CONFIG_CONTENT: '{"model":"provider/inline"}' })).toBe('provider/inline')
            await writeFile(override, '{"mcp":{}}')
            expect(modelName({ OPENCODE_CONFIG: override })).toBe('provider/jsonc')
        } finally {
            await rm(directory, { recursive: true, force: true })
        }
    })

    it('uses PATHEXT when resolving Windows commands', () => {
        expect(executableCandidates('agent', {
            platform: 'win32',
            pathValue: 'C:\\Tools;D:\\Bin',
            pathExt: '.EXE;.CMD',
        })).toEqual([
            'C:\\Tools\\agent.EXE',
            'C:\\Tools\\agent.CMD',
            'D:\\Bin\\agent.EXE',
            'D:\\Bin\\agent.CMD',
        ])
    })

    it('reports missing executables without invoking them', () => {
        expect(getAgentAvailability('grok', { PATH: '' })).toEqual({
            agent: 'grok',
            available: false,
            reason: 'not_found',
        })
    })

    it('keeps fork-disabled agents out of the pickers even when installed', () => {
        expect(getAgentAvailability('gemini', { PATH: '' })).toEqual({
            agent: 'gemini',
            available: false,
            reason: 'not_found',
        })
        expect(getAgentAvailability('kimi', { PATH: '' })).toEqual({
            agent: 'kimi',
            available: false,
            reason: 'not_found',
        })
        expect(getAgentAvailability('claude', { PATH: '' })).toEqual({
            agent: 'claude',
            available: false,
            reason: 'not_found',
        })
        expect(getAgentAvailability('codex', {
            PATH: '',
            HAPI_CODEX_APP_SERVER_BIN: '/missing/codex',
        })).toEqual({
            agent: 'codex',
            available: false,
            reason: 'invalid_configuration',
        })
    })

    it('uses the configured Codex app-server executable for availability', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'hapi-agent-path-'))
        const codex = await makeExecutable(directory, 'codex-app-server')

        expect(getAgentAvailability('codex', {
            PATH: '',
            HAPI_CODEX_APP_SERVER_BIN: codex,
        })).toEqual({ agent: 'codex', available: true })
    })

    it('checks the terminal Codex executable independently of the runner override', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'hapi-agent-path-'))
        const codex = await makeExecutable(directory, 'codex')
        const resolveSpy = vi.spyOn(codexExecutable, 'resolveCodexCommand')
        try {
            resolveSpy.mockReturnValue({ command: codex, args: [] })
            expect(getAgentAvailability('codex', {
                PATH: '', HAPI_CODEX_APP_SERVER_BIN: '/missing/app-server'
            }, 'terminal')).toEqual({ agent: 'codex', available: true })

            resolveSpy.mockReturnValue({ command: join(directory, 'missing-codex'), args: [] })
            expect(getAgentAvailability('codex', {
                PATH: '', HAPI_CODEX_APP_SERVER_BIN: codex
            }, 'terminal')).toEqual({ agent: 'codex', available: false, reason: 'not_found' })
        } finally {
            resolveSpy.mockRestore()
        }
    })

    it('rejects malformed or missing DSH static configuration', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'hapi-agent-path-'))
        await makeExecutable(directory, 'dsh-acp-demo')
        expect(getAgentAvailability('dsh', {
            PATH: directory,
            HAPI_DSH_ACP_ARGS_JSON: 'not json',
        }).reason).toBe('invalid_configuration')
        expect(getAgentAvailability('dsh', {
            PATH: directory,
            HAPI_DSH_ACP_CONFIG: join(directory, 'missing.yml'),
        }).reason).toBe('invalid_configuration')

        const config = join(directory, 'cordis.yml')
        await writeFile(config, 'agents: []\n')
        expect(getAgentAvailability('dsh', {
            PATH: directory,
            HAPI_DSH_ACP_CONFIG: config,
        })).toEqual({ agent: 'dsh', available: true })
    })

    it('accepts a macOS Codex app executable when the CLI is absent', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'hapi-agent-path-'))
        const appCommand = join(directory, 'Codex.app', 'Contents', 'Resources', 'codex')
        await mkdir(join(directory, 'Codex.app', 'Contents', 'Resources'), { recursive: true })
        await writeFile(appCommand, '#!/bin/sh\n')
        await chmod(appCommand, 0o755)

        expect(resolveExecutable(appCommand, { pathValue: '' })).toBe(appCommand)
    })
})
