import chalk from 'chalk'
import { updateDifitReviewAttachment } from '@/modules/difitReviewAttachment'
import { initializeToken } from '@/ui/tokenInit'
import type { CommandDefinition } from './types'

type ParsedDifitReviewArgs = {
    help: boolean
    action?: 'attach' | 'detach'
    sessionId?: string
    reviewId?: string
    url?: string
    reviewUrl?: string
    branch?: string
}

function showHelp(): void {
    console.log(`
${chalk.bold('hapi difit-review')} - Attach a DIFIT review to the current HAPI session

${chalk.bold('Usage:')}
  hapi difit-review attach --review-id <id> --url <public-url> [--review-url <url>] [--branch <branch>]
  hapi difit-review detach --review-id <id>

The session defaults to HAPI_SESSION_ID. --session-id is reserved for a DIFIT hub
detaching a review after its viewer process has stopped.
`)
}

export function parseDifitReviewArgs(args: string[]): ParsedDifitReviewArgs {
    const parsed: ParsedDifitReviewArgs = { help: false }
    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index]!
        if (arg === '--help' || arg === '-h') {
            parsed.help = true
            continue
        }
        if (!parsed.action && (arg === 'attach' || arg === 'detach')) {
            parsed.action = arg
            continue
        }
        const key = arg.startsWith('--') ? arg.slice(2) : ''
        if (!['session-id', 'review-id', 'url', 'review-url', 'branch'].includes(key)) {
            throw new Error(`Unexpected argument: ${arg}`)
        }
        const value = args[index + 1]
        if (!value) throw new Error(`--${key} requires a value`)
        index += 1
        if (key === 'session-id') parsed.sessionId = value
        else if (key === 'review-id') parsed.reviewId = value
        else if (key === 'url') parsed.url = value
        else if (key === 'review-url') parsed.reviewUrl = value
        else parsed.branch = value
    }
    return parsed
}

export async function handleDifitReviewCommand(args: string[]): Promise<void> {
    const parsed = parseDifitReviewArgs(args)
    if (parsed.help) {
        showHelp()
        return
    }
    if (!parsed.action) throw new Error('Expected attach or detach')

    const sessionId = parsed.sessionId?.trim() || process.env.HAPI_SESSION_ID?.trim()
    if (!sessionId) throw new Error('HAPI_SESSION_ID or --session-id is required')
    if (!parsed.reviewId?.trim()) throw new Error('--review-id is required')
    if (parsed.action === 'attach' && !parsed.url?.trim()) throw new Error('--url is required for attach')

    await initializeToken()
    await updateDifitReviewAttachment({
        action: parsed.action,
        attachment: {
            sessionId,
            reviewId: parsed.reviewId.trim(),
            ...(parsed.url ? { url: parsed.url.trim() } : {}),
            ...(parsed.reviewUrl ? { reviewUrl: parsed.reviewUrl.trim() } : {}),
            ...(parsed.branch ? { branch: parsed.branch.trim() } : {})
        }
    })
    console.log(chalk.green(`hapi difit-review: ${parsed.action}ed ${parsed.reviewId}`))
}

export const difitReviewCommand: CommandDefinition = {
    name: 'difit-review',
    requiresRuntimeAssets: false,
    run: async ({ commandArgs }) => {
        try {
            await handleDifitReviewCommand(commandArgs)
        } catch (error) {
            console.error(
                chalk.red('hapi difit-review:'),
                error instanceof Error ? error.message : 'Unknown error'
            )
            process.exit(1)
        }
    }
}
