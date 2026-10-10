import { z } from 'zod'
import { AgentFlavorSchema, CREATABLE_AGENT_FLAVORS } from '@hapi/protocol'
import { PermissionModeSchema } from '@hapi/protocol/schemas'

export const LAUNCH_OPTIONS_DESCRIPTION = 'Discover projects and installed agents for launching HAPI sessions, like the web + picker. Lists online runners, workspace directories, recent project paths and native default models in the current hub namespace. Use a returned project path and agent with launch_agent. Optional machineId narrows discovery.'
export const LAUNCH_AGENT_DESCRIPTION = 'Launch another agent in a HAPI session and deliver its task once, like the web + picker. Select project and agent from list_launch_options. Defaults: Codex, native model/effort, maximum permissions (YOLO), remote mode. Omit machineId to use the caller runner (or the only online runner). Return includes session link for inspect_peer / ping_peer. Choose a unique requestId per task and reuse it with identical arguments on retries. Retry protection lasts for this caller MCP server lifetime. An uncertain spawn is never automatically repeated.'

export const launchOptionsSchema = z.object({
    machineId: z.string().trim().min(1).optional().describe('Online runner ID or unique prefix; omit to discover all runners'),
})

export const launchAgentSchema = z.object({
    project: z.string().trim().min(1).describe('Project directory path or unique project name from list_launch_options'),
    message: z.string().trim().min(1).describe('Initial task for the new agent'),
    agent: AgentFlavorSchema.refine((agent) => CREATABLE_AGENT_FLAVORS.includes(agent), 'Agent cannot be launched').optional().describe('Agent flavor, default codex'),
    requestId: z.string().trim().min(1).max(128).describe('Unique task request ID. Reuse it and identical arguments when retrying this launch'),
    machineId: z.string().trim().min(1).optional().describe('Runner ID or unique prefix; default caller runner'),
    model: z.string().trim().min(1).optional().describe('Optional native model ID; omit for agent default'),
    effort: z.string().trim().min(1).optional().describe('Optional agent reasoning effort; omit for native default'),
    permissionMode: PermissionModeSchema.optional().describe('Optional permission override; default maximum permissions'),
    worktreeName: z.string().trim().min(1).optional().describe('Create a Git worktree with this name instead of using the project directory directly'),
})
export type LaunchAgentArgs = z.infer<typeof launchAgentSchema>
