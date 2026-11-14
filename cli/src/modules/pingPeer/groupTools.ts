import { z } from 'zod'
import { createHash } from 'node:crypto'
import { CreateSessionGroupSchema, type SessionGroup } from '@hapi/protocol'
import { assertPeerToolsEnabled, connectPeerHub } from './pingPeer'

export const groupInfoSchema = z.object({
    groupId: z.string().min(1).optional().describe('Exact group ID; omit to read this session’s current group'),
})
export const GROUP_INFO_DESCRIPTION = 'Read a HAPI group of equal, independent chats. Omit groupId for this session’s current group. Returns its name, persisted tab order/pins and chat states, Closed chats leave their group and retain standalone history. Read a chat’s context with inspect_peer(sessionIdPrefix: sessionId); that tool supports older-page cursors. Group membership never merges histories or grants extra access.'
export const GROUP_LIST_DESCRIPTION = 'List user-created chat groups in this hub namespace, with IDs, names, tab order and pins. Use get_group for live chat states and inspect_peer for a chat’s context. Use create_group to create a named group, add_group_chat to move an existing chat, and arrange_group_tabs to change tab order and pins.'

export async function readGroup(callerSessionId: string, args: z.infer<typeof groupInfoSchema>) {
    assertPeerToolsEnabled()
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
    assertPeerToolsEnabled()
    return await (await connectPeerHub()).get('/groups')
}

export const createGroupSchema = CreateSessionGroupSchema.extend({
    requestId: z.string().trim().min(1).max(128).describe('Unique creation request ID. Reuse it and the same name on retries, including after a timeout or uncertain result. Use a new ID for a separate group.'),
})
export const GROUP_CREATE_DESCRIPTION = 'Create an empty named HAPI chat group in this hub namespace. Returns groupId and the persisted group for get_group and launch_agent(groupId). Names are trimmed and must contain 1–120 characters. Requires a stable requestId: retry with the SAME ID and name after errors or a lost response to avoid duplicates, even across hub restarts. Reusing an ID with another name is rejected. Equal names with different IDs create separate groups. Does not move existing chats or change this session’s membership.'

export async function createGroup(callerSessionId: string, args: z.infer<typeof createGroupSchema>) {
    const input = createGroupSchema.parse(args)
    assertPeerToolsEnabled()
    const hub = await connectPeerHub()
    const { group } = await hub.post<{ group: SessionGroup }>('/groups', {
        name: input.name,
        requestId: 'mcp:' + createHash('sha256').update(JSON.stringify([callerSessionId, input.requestId])).digest('hex'),
    })
    return { groupId: group.id, group }
}

export const pinGroupSchema = groupInfoSchema.extend({ pinned: z.boolean().describe('True to pin the group in the chat list, false to unpin') })
export const PIN_GROUP_DESCRIPTION = 'Pin or unpin a group in the chat list. Omit groupId for the current session’s group. Does not alter pins on group tabs.'
export async function pinGroup(callerSessionId: string, args: z.infer<typeof pinGroupSchema>) {
    assertPeerToolsEnabled()
    const hub = await connectPeerHub()
    let id = args.groupId
    if (!id) {
        const { group } = await hub.get<{ group: SessionGroup | null }>(`/sessions/${encodeURIComponent(callerSessionId)}/group`)
        if (!group) throw new Error('Current session is not in a group')
        id = group.id
    }
    const { group } = await hub.get<{ group: SessionGroup }>(`/groups/${encodeURIComponent(id)}`)
    if (group.pinned === args.pinned) return { group }
    return hub.put(`/groups/${encodeURIComponent(id)}`, { ...group, pinned: args.pinned })
}

export const addGroupChatSchema = z.object({ groupId: z.string().min(1), sessionId: z.string().min(1).optional().describe('Exact chat ID; omit for the current chat') })
export const ADD_GROUP_CHAT_DESCRIPTION = 'Add an existing chat to a group, moving it from its previous group if necessary. Omit sessionId for the current chat. Use only when the user authorizes the change.'
export async function addGroupChat(callerSessionId: string, args: z.infer<typeof addGroupChatSchema>) {
    assertPeerToolsEnabled()
    const hub = await connectPeerHub()
    await hub.post(`/groups/${encodeURIComponent(args.groupId)}/members`, { sessionId: args.sessionId ?? callerSessionId })
    return hub.get(`/groups/${encodeURIComponent(args.groupId)}`)
}

export const arrangeGroupTabsSchema = z.object({ groupId: z.string().min(1), version: z.number().int().positive(), members: z.array(z.object({ sessionId: z.string().min(1), pinned: z.boolean() })) })
export const ARRANGE_GROUP_TABS_DESCRIPTION = 'Set the order and pins of all existing group tabs. Read get_group first and supply its exact version and complete member list. Rejects membership changes and concurrent updates. Use only when authorized.'
export async function arrangeGroupTabs(_callerSessionId: string, args: z.infer<typeof arrangeGroupTabsSchema>) {
    assertPeerToolsEnabled()
    const hub = await connectPeerHub()
    const { group } = await hub.get<{ group: SessionGroup }>(`/groups/${encodeURIComponent(args.groupId)}`)
    if (group.version !== args.version) throw new Error('Group changed. Read it again and retry.')
    const current = new Set(group.members.map(member => member.sessionId))
    const proposed = new Set(args.members.map(member => member.sessionId))
    if (current.size !== args.members.length || proposed.size !== current.size || [...proposed].some(id => !current.has(id))) throw new Error('Members must match the current group exactly')
    return hub.put(`/groups/${encodeURIComponent(group.id)}`, { ...group, members: args.members })
}

export const unlockTitleSchema = z.object({ expectedName: z.string().min(1), expectedLock: z.enum(['user', 'agent']) })
export const UNLOCK_TITLE_DESCRIPTION = 'Remove protection from the current chat title, retaining its name. Requires the exact current title and ownership from read_title_state. Only use when the user explicitly requests removing this title protection. Does not rename or unpin a group or tab.'
export async function unlockTitle(callerSessionId: string, args: z.infer<typeof unlockTitleSchema>) {
    assertPeerToolsEnabled()
    return (await connectPeerHub()).post(`/sessions/${encodeURIComponent(callerSessionId)}/unlock-title`, args)
}

export const READ_TITLE_STATE_DESCRIPTION = 'Read the current chat title and its protection owner before a user-authorized unlock.'
export async function readTitleState(callerSessionId: string) {
    assertPeerToolsEnabled()
    const { session } = await (await connectPeerHub()).get<{ session: { metadata?: { name?: string; nameLock?: string } } }>(`/sessions/${encodeURIComponent(callerSessionId)}`)
    return { name: session.metadata?.name ?? null, nameLock: session.metadata?.nameLock ?? null }
}
