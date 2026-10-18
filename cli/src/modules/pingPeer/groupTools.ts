import { z } from 'zod'
import type { SessionGroup } from '@hapi/protocol'
import { connectPeerHub } from './pingPeer'

export const groupInfoSchema = z.object({
    groupId: z.string().min(1).optional().describe('Exact group ID; omit to read this session’s current group'),
})
export const GROUP_INFO_DESCRIPTION = 'Read a HAPI group of equal, independent chats. Omit groupId for this session’s current group. Returns its name, persisted tab order/pins and chat states, Closed chats leave their group and retain standalone history. Read a chat’s context with inspect_peer(sessionIdPrefix: sessionId); that tool supports older-page cursors. Group membership never merges histories or grants extra access.'
export const GROUP_LIST_DESCRIPTION = 'List user-created chat groups in this hub namespace, with IDs, names, tab order and pins. Use get_group for live chat states and inspect_peer for a chat’s context. Read-only; agents cannot reorganize the user’s groups.'

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
