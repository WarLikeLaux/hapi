import chalk from 'chalk'
import { initializeToken } from '@/ui/tokenInit'
import { exitCodeForPingPeerError, PingPeerError } from '@/modules/pingPeer/pingPeer'
import { formatUsageReport, getUsage, usageSchema } from '@/modules/usage'
import type { CommandDefinition } from './types'

const USAGE_FLAGS = new Map([
    ['--range', 'range'],
    ['--session', 'sessionIdPrefix'],
    ['--time-zone', 'timeZone'],
])

function showHelp(): void {
    console.log(`hapi get usage - Read session token usage collected by HAPI

Usage:
  hapi get usage [--range 7d|30d|all] [--session <id-or-prefix>]
                 [--time-zone <IANA-zone>] [--json]

Defaults: last 7 days, UTC, namespace summary. --session selects one chat.
--json prints the full summary (totals, daily, byAgent, byModel, range,
updatedAt, sessionId); stdout contains only JSON on success.
Uses HAPI_API_URL / CLI_API_TOKEN or saved hapi auth login credentials.
Requires the hub owner's default namespace, just like the Usage dashboard.
Shows collected tokens, not remaining subscription quota. Missing provider
usage is not estimated; no prices or costs are calculated.`)
}

export async function handleGetCommand(args: string[]): Promise<void> {
    if (args.length === 1 && ['--help', '-h'].includes(args[0]!)) {
        showHelp()
        return
    }
    if (args[0] !== 'usage') throw new PingPeerError('bad_args', 'expected: hapi get usage [options]')
    const input: Record<string, string> = {}
    let json = false
    for (let i = 1; i < args.length; i++) {
        const arg = args[i]!
        if (arg === '--help' || arg === '-h') { showHelp(); return }
        if (arg === '--json') { json = true; continue }
        const [flag, ...inline] = arg.split('=')
        const key = USAGE_FLAGS.get(flag!)
        if (!key) throw new PingPeerError('bad_args', `unexpected argument: ${arg}`)
        const value = inline.length ? inline.join('=') : args[++i]
        if (!value || value.startsWith('--')) throw new PingPeerError('bad_args', `${flag} requires a value`)
        input[key] = value
    }
    const parsed = usageSchema.safeParse(input)
    if (!parsed.success) throw new PingPeerError('bad_args', parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; '))
    await initializeToken()
    const report = await getUsage(parsed.data)
    console.log(json ? JSON.stringify(report, null, 2) : formatUsageReport(report))
}

export const getCommand: CommandDefinition = {
    name: 'get',
    requiresRuntimeAssets: false,
    run: async ({ commandArgs }) => {
        try {
            await handleGetCommand(commandArgs)
        } catch (error) {
            console.error(chalk.red('hapi get:'), error instanceof Error ? error.message : 'Unknown error')
            process.exit(error instanceof PingPeerError ? exitCodeForPingPeerError(error) : 1)
        }
    },
}
