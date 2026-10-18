import { z } from 'zod'
import { createHash } from 'node:crypto'
import { CreateSessionGroupSchema, type SessionGroup } from '@hapi/protocol'
import { connectPeerHub } from './pingPeer'

export const groupInfoSchema = z.object({
    groupId: z.string().min(1).optional().describe('Exact group ID; omit to read this session’s current group'),
})
export const GROUP_INFO_DESCRIPTION = 'Read a HAPI group of equal, independent chats. Omit groupId for this session’s current group. Returns its name, persisted tab order/pins and chat states, Closed chats leave their group and retain standalone history. Read a chat’s context with inspect_peer(sessionIdPrefix: sessionId); that tool supports older-page cursors. Group membership never merges histories or grants extra access.'
export const GROUP_LIST_DESCRIPTION = 'List user-created chat groups in this hub namespace, with IDs, names, tab order and pins. Use get_group for live chat states and inspect_peer for a chat’s context. Use create_group to create a named group; these tools do not reorganize existing groups.'

export async function readGroup(callerSessionId: string, args: z.infer<typeof groupInfoSchema>) {
    const hub = await connectPeerHub()
    let id = args.groupId
    if (!id) {
        const { group } = await hub.get<{ group: SessionGroup | null }>(`/sessions/${encodeURIComponent(callerSessionId)}/group`)
        if (!group) return { group: null, sessions: [], contextTool: 'inspect_peer' }
        id = group.id
    }
    return { ...await hub.get<object>(`/groups/${encodeURIComponent(id)}`), contextTool: 'inspect_peer', contextArgument: 'sessionIdPrefix' }
}

export async function listGroups() {
    return await (await connectPeerHub()).get('/groups')
}

export const createGroupSchema = CreateSessionGroupSchema.extend({
    requestId: z.string().trim().min(1).max(128).describe('Unique creation request ID. Reuse it and the same name on retries, including after a timeout or uncertain result. Use a new ID for a separate group.'),
})
export const GROUP_CREATE_DESCRIPTION = 'Create an empty named HAPI chat group in this hub namespace. Returns groupId and the persisted group for get_group and launch_agent(groupId). Names are trimmed and must contain 1–120 characters. Requires a stable requestId: retry with the SAME ID and name after errors or a lost response to avoid duplicates, even across hub restarts. Reusing an ID with another name is rejected. Equal names with different IDs create separate groups. Does not move existing chats or change this session’s membership.'

export async function createGroup(callerSessionId: string, args: z.infer<typeof createGroupSchema>) {
    const input = createGroupSchema.parse(args)
    const hub = await connectPeerHub()
    const { group } = await hub.post<{ group: SessionGroup }>('/groups', {
        name: input.name,
        requestId: 'mcp:' + createHash('sha256').update(JSON.stringify([callerSessionId, input.requestId])).digest('hex'),
    })
    return { groupId: group.id, group }
}
