import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import psList from 'ps-list'
import type { ManageDifitResponse } from '@hapi/protocol/apiTypes'
import { RPC_METHODS } from '@hapi/protocol/rpcMethods'
import type { RpcHandlerManager } from '@/api/rpc/RpcHandlerManager'
import { validatePath } from '../pathSecurity'
import { getErrorMessage, rpcError } from '../rpcResponses'

const execFileAsync = promisify(execFile)

type ManageDifitRequest = {
    action: 'start' | 'restart'
    cwd: string
    sessionId: string
    reviewId?: string
}

type DifitRegistration = {
    id: string
    repositoryPath: string
    branch?: string
    baseRef: string
    targetRef: string
    reviewUrl?: string
    pid: number
    hapiSessionId?: string
}

type DifitHandshake = {
    browserUrl: string
    pid: number
}

function registrationPath(reviewId: string): string {
    const configDirectory = process.env.DIFIT_CONFIG_DIR?.trim() || join(homedir(), '.difit')
    return join(configDirectory, 'reviews', `${reviewId}.json`)
}

async function readRegistration(reviewId: string): Promise<DifitRegistration> {
    if (!/^[a-f0-9]{24}$/i.test(reviewId)) throw new Error('Invalid DIFIT review id')
    const parsed = JSON.parse(await readFile(registrationPath(reviewId), 'utf8')) as Partial<DifitRegistration>
    if (
        parsed.id !== reviewId
        || typeof parsed.repositoryPath !== 'string'
        || typeof parsed.baseRef !== 'string'
        || typeof parsed.targetRef !== 'string'
        || typeof parsed.pid !== 'number'
    ) {
        throw new Error('Invalid DIFIT review registration')
    }
    return parsed as DifitRegistration
}

export function buildDifitArgs(registration?: DifitRegistration): string[] {
    const args = ['.']
    if (registration?.targetRef === '.' && registration.baseRef !== 'HEAD') {
        args.push(registration.baseRef)
    }
    args.push('--include-untracked')
    if (registration?.reviewUrl) args.push('--gitlab-mr', registration.reviewUrl)
    args.push('--background')
    return args
}

async function stopRegisteredViewer(
    registration: DifitRegistration,
    sessionId: string,
    repositoryPath: string
): Promise<void> {
    if (resolve(registration.repositoryPath) !== resolve(repositoryPath)) {
        throw new Error('DIFIT review belongs to a different repository')
    }
    if (registration.hapiSessionId && registration.hapiSessionId !== sessionId) {
        throw new Error('DIFIT review belongs to a different HAPI session')
    }

    const processInfo = (await psList()).find((entry) => entry.pid === registration.pid)
    if (!processInfo) return
    const command = `${processInfo.name ?? ''} ${processInfo.cmd ?? ''}`.toLowerCase()
    if (!command.includes('difit')) throw new Error('Refusing to stop an unrelated process')

    process.kill(registration.pid, 'SIGTERM')
    const deadline = Date.now() + 3_000
    while (Date.now() < deadline) {
        await new Promise((resolveWait) => setTimeout(resolveWait, 50))
        try {
            process.kill(registration.pid, 0)
        } catch {
            return
        }
    }
    throw new Error('DIFIT viewer did not stop')
}

async function runDifit(args: string[], cwd: string, sessionId: string): Promise<DifitHandshake> {
    const options = {
        cwd,
        env: {
            ...process.env,
            HAPI_SESSION_ID: sessionId,
            HAPI_CLI_EXECUTABLE: process.env.HAPI_CLI_EXECUTABLE?.trim() || process.execPath
        },
        timeout: 30_000,
        maxBuffer: 1024 * 1024
    }
    let stdout: string
    try {
        const result = await execFileAsync('difit', args, options)
        stdout = result.stdout
    } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (code !== 'ENOENT') throw error
        const result = await execFileAsync('npx', ['difit', ...args], options)
        stdout = result.stdout
    }

    const line = stdout.trim().split(/\r?\n/).at(-1)
    const parsed = line ? JSON.parse(line) as Partial<DifitHandshake> : null
    if (!parsed || typeof parsed.browserUrl !== 'string' || typeof parsed.pid !== 'number') {
        throw new Error('DIFIT did not return a browser URL')
    }
    return parsed as DifitHandshake
}

export function registerDifitHandlers(rpcHandlerManager: RpcHandlerManager, workingDirectory: string): void {
    rpcHandlerManager.registerHandler<ManageDifitRequest, ManageDifitResponse>(RPC_METHODS.ManageDifit, async (data) => {
        const validation = validatePath(data.cwd, workingDirectory)
        if (!validation.valid) return rpcError(validation.error ?? 'Invalid working directory')
        if (!data.sessionId.trim()) return rpcError('HAPI session id is required')

        try {
            const gitRootResult = await execFileAsync('git', ['rev-parse', '--show-toplevel'], { cwd: data.cwd })
            const repositoryPath = gitRootResult.stdout.trim()
            let registration: DifitRegistration | undefined
            if (data.action === 'restart') {
                if (!data.reviewId) throw new Error('DIFIT review id is required for restart')
                registration = await readRegistration(data.reviewId)
                await stopRegisteredViewer(registration, data.sessionId, repositoryPath)
            }

            const handshake = await runDifit(buildDifitArgs(registration), repositoryPath, data.sessionId)
            const reviewId = new URL(handshake.browserUrl).pathname.match(/\/reviews\/([^/]+)/)?.[1]
            if (!reviewId) throw new Error('DIFIT returned an invalid browser URL')
            const currentRegistration = await readRegistration(decodeURIComponent(reviewId))
            if (registration && currentRegistration.id !== registration.id) {
                throw new Error('DIFIT restart did not preserve the review identity')
            }
            return {
                success: true,
                reviewId: currentRegistration.id,
                url: handshake.browserUrl,
                ...(currentRegistration.reviewUrl ? { reviewUrl: currentRegistration.reviewUrl } : {}),
                ...(currentRegistration.branch ? { branch: currentRegistration.branch } : {})
            }
        } catch (error) {
            return rpcError(getErrorMessage(error, 'Failed to manage DIFIT'))
        }
    })
}
