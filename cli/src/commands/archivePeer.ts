import chalk from 'chalk'
import { initializeToken } from '@/ui/tokenInit'
import { archivePeer, exitCodeForPingPeerError, PingPeerError } from '@/modules/pingPeer/pingPeer'
import type { CommandDefinition } from './types'

function showHelp(): void {
    console.log(`
${chalk.bold('hapi archive-peer')} - Stop and archive an idle HAPI session

${chalk.bold('Usage:')}
  hapi archive-peer <full-session-uuid>

${chalk.bold('Notes:')}
  Use inspect-peer to verify the exact session and its task before archiving.
  The target must be idle. This command never resumes a session.
  Session history remains available in HAPI.
`)
}

export async function handleArchivePeerCommand(args: string[]): Promise<void> {
    if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) {
        showHelp()
        return
    }
    if (args.length !== 1 || !args[0] || args[0].startsWith('-')) {
        showHelp()
        throw new PingPeerError('bad_args', 'expected one full HAPI session UUID')
    }

    await initializeToken()
    const result = await archivePeer({ sessionId: args[0] })
    console.log(chalk.green(`hapi archive-peer: ${result.alreadyArchived ? 'already archived' : 'archived'} ${result.sessionId}`))
}

export const archivePeerCommand: CommandDefinition = {
    name: 'archive-peer',
    requiresRuntimeAssets: false,
    run: async ({ commandArgs }) => {
        try {
            await handleArchivePeerCommand(commandArgs)
        } catch (error) {
            if (error instanceof PingPeerError) {
                console.error(chalk.red('hapi archive-peer:'), error.message)
                process.exit(exitCodeForPingPeerError(error))
            }
            console.error(chalk.red('hapi archive-peer:'), error instanceof Error ? error.message : 'Unknown error')
            if (process.env.DEBUG) console.error(error)
            process.exit(1)
        }
    }
}
