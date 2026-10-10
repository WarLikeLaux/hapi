import type { z } from 'zod'
import {
    AgentAvailabilityResponseSchema,
    CREATABLE_AGENT_FLAVORS,
    getLaunchPermissionModesForFlavor,
    resolveHapiYoloPermissionMode,
    type AgentAvailabilityEntry,
    type Machine,
    type MachineListDirectoryResponse,
    type SpawnSessionRequest,
} from '@hapi/protocol'
import { connectPeerHub, pingPeer } from './pingPeer'
import { launchAgentSchema, launchOptionsSchema, type LaunchAgentArgs } from './launchAgentTools'

type ProjectSession = {
    id: string
    metadata?: { machineId?: string; path?: string; worktree?: { basePath?: string } } | null
}
type LaunchOptions = {
    machines: Array<{
        id: string
        name: string
        projects: string[]
        agents: AgentAvailabilityEntry[]
        discoveryErrors: string[]
    }>
}
type LaunchResult = { sessionId: string; url: string; messageDelivered: true }
type LaunchRequest = {
    signature: string
    sessionId?: string
    spawnAttempted: boolean
    pending?: Promise<LaunchResult>
    result?: LaunchResult
}

function resolveMachine(machines: Machine[], prefix: string): Machine {
    const exact = machines.find((machine) => machine.id === prefix)
    if (exact) return exact
    const matches = machines.filter((machine) => machine.id.startsWith(prefix))
    if (matches.length !== 1) throw new Error(`Runner '${prefix}' is ${matches.length ? 'ambiguous' : 'offline or unknown'}; use list_launch_options`)
    return matches[0]!
}

function projectName(path: string): string {
    return path.split(/[\\/]/).filter(Boolean).pop() ?? path
}

async function discoverProjects(hub: Awaited<ReturnType<typeof connectPeerHub>>, machine: Machine, sessions: ProjectSession[]) {
    const projects = new Set<string>()
    const errors: string[] = []
    for (const session of sessions) {
        if (session.metadata?.machineId !== machine.id) continue
        const directory = session.metadata.worktree?.basePath ?? session.metadata.path
        if (directory) projects.add(directory)
    }
    for (const root of machine.metadata?.workspaceRoots ?? []) {
        projects.add(root)
        try {
            const listing = await hub.post<MachineListDirectoryResponse>(`/machines/${encodeURIComponent(machine.id)}/list-directory`, { path: root })
            if (!listing.success) throw new Error(listing.error ?? 'Directory discovery failed')
            const separator = root.includes('\\') ? '\\' : '/'
            for (const entry of listing.entries ?? []) {
                if (entry.type === 'directory') projects.add(`${root.replace(/[\\/]+$/, '')}${separator}${entry.name}`)
            }
        } catch (error) {
            errors.push(`${root}: ${error instanceof Error ? error.message : String(error)}`)
        }
    }
    return { projects: [...projects].sort(), errors }
}

/** Shared by all HTTP MCP transports belonging to one caller session. */
export function createAgentLauncher(callerSessionId: string) {
    const requests = new Map<string, LaunchRequest>()

    async function listOptions(args: z.infer<typeof launchOptionsSchema> = {}): Promise<LaunchOptions> {
        const hub = await connectPeerHub()
        const [{ machines }, { sessions }] = await Promise.all([
            hub.get<{ machines: Machine[] }>('/machines'),
            hub.get<{ sessions: ProjectSession[] }>('/sessions'),
        ])
        const selected = args.machineId ? [resolveMachine(machines, args.machineId)] : machines
        return { machines: await Promise.all(selected.map(async (machine) => {
            const { projects, errors } = await discoverProjects(hub, machine, sessions)
            let agents: AgentAvailabilityEntry[] = []
            try {
                const response = AgentAvailabilityResponseSchema.parse(await hub.get(`/machines/${encodeURIComponent(machine.id)}/agent-availability`))
                agents = response.agents.filter((entry) => CREATABLE_AGENT_FLAVORS.includes(entry.agent))
            } catch (error) {
                errors.push(error instanceof Error ? error.message : String(error))
            }
            return {
                id: machine.id,
                name: machine.metadata?.displayName ?? machine.metadata?.host ?? machine.id,
                projects,
                agents,
                discoveryErrors: errors,
            }
        })) }
    }

    async function performLaunch(args: LaunchAgentArgs, request: LaunchRequest): Promise<LaunchResult> {
        const hub = await connectPeerHub()
        if (!request.sessionId) {
            if (request.spawnAttempted) throw new Error('Spawn outcome is uncertain. Inspect list_peers before starting another request; this request will not spawn again.')
            const { machines } = await hub.get<{ machines: Machine[] }>('/machines')
            const { session: caller } = await hub.get<{ session: ProjectSession }>(`/sessions/${encodeURIComponent(callerSessionId)}`)
            const runnerId = args.machineId ?? caller.metadata?.machineId
            const machine = runnerId ? resolveMachine(machines, runnerId) : machines.length === 1 ? machines[0]! : undefined
            if (!machine) throw new Error('Select a runner with machineId from list_launch_options')
            const agent = args.agent ?? 'codex'
            const availability = AgentAvailabilityResponseSchema.parse(await hub.get(`/machines/${encodeURIComponent(machine.id)}/agent-availability`))
            if (!availability.agents.some((entry) => entry.agent === agent && entry.available)) throw new Error(`Agent '${agent}' is unavailable on runner ${machine.id}`)
            let directory = args.project
            if (!/^(\/|[A-Za-z]:[\\/]|\\\\)/.test(directory)) {
                const { sessions } = await hub.get<{ sessions: ProjectSession[] }>('/sessions')
                const { projects } = await discoverProjects(hub, machine, sessions)
                const matches = projects.filter((path) => projectName(path) === directory)
                if (matches.length !== 1) throw new Error(`Project '${directory}' is ${matches.length ? 'ambiguous' : 'unknown'}; use an absolute path from list_launch_options`)
                directory = matches[0]!
            }
            const exists = await hub.post<{ exists: Record<string, boolean> }>(`/machines/${encodeURIComponent(machine.id)}/paths/exists`, { paths: [directory] })
            if (!exists.exists[directory]) throw new Error(`Project directory does not exist or is outside workspace roots: ${directory}`)
            if (args.permissionMode && !getLaunchPermissionModesForFlavor(agent).includes(args.permissionMode)) throw new Error(`Permission mode '${args.permissionMode}' is unsupported for ${agent}`)
            if (args.effort && !['claude', 'grok', 'pi', 'agy', 'codex', 'opencode'].includes(agent)) throw new Error(`Agent '${agent}' does not support a separate effort override; choose its native model variant instead`)
            const payload: SpawnSessionRequest = {
                directory,
                agent,
                model: args.model,
                ...(agent === 'codex' || agent === 'opencode' ? { modelReasoningEffort: args.effort } : { effort: args.effort }),
                permissionMode: args.permissionMode ?? resolveHapiYoloPermissionMode(agent) ?? undefined,
                yolo: args.permissionMode === undefined,
                startingMode: 'remote',
                sessionType: args.worktreeName ? 'worktree' : 'simple',
                worktreeName: args.worktreeName,
            }
            request.spawnAttempted = true
            const spawned = await hub.post<{ type: string; sessionId?: string; message?: string }>(`/machines/${encodeURIComponent(machine.id)}/spawn`, payload)
            if (spawned.type !== 'success' || !spawned.sessionId) throw new Error(`${spawned.message ?? 'Failed to spawn agent'}. Inspect list_peers before starting another request.`)
            request.sessionId = spawned.sessionId
        }
        try {
            await pingPeer({
                sessionIdPrefix: request.sessionId,
                message: args.message,
                localId: `launch:${callerSessionId}:${args.requestId}`,
            })
        } catch (error) {
            throw new Error(`Session created: /sessions/${request.sessionId}. Task delivery failed: ${error instanceof Error ? error.message : String(error)}. Retry the same requestId and arguments to deliver to this session.`)
        }
        return { sessionId: request.sessionId, url: `/sessions/${request.sessionId}`, messageDelivered: true }
    }

    async function launch(input: LaunchAgentArgs): Promise<LaunchResult> {
        const args = launchAgentSchema.parse(input)
        const signature = JSON.stringify({ ...args, agent: args.agent ?? 'codex' })
        let request = requests.get(args.requestId)
        if (request && request.signature !== signature) throw new Error('requestId was already used with different arguments; choose a new ID for a new task')
        if (!request) {
            // Never evict a receipt and silently turn a retry into another spawn.
            if (requests.size >= 100) throw new Error('This caller reached the 100 launch request limit; start a new caller session')
            request = { signature, spawnAttempted: false }
            requests.set(args.requestId, request)
        }
        if (request.result) return request.result
        if (request.pending) return request.pending
        const receipt = request
        receipt.pending = performLaunch(args, receipt)
        try {
            receipt.result = await receipt.pending
            return receipt.result
        } finally {
            receipt.pending = undefined
        }
    }

    return { listOptions, launch }
}
