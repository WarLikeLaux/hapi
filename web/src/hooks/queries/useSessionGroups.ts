import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { UpdateSessionGroup } from '@hapi/protocol'
import type { ApiClient } from '@/api/client'

export const sessionGroupsKey = ['session-groups'] as const

export function useSessionGroups(api: ApiClient | null) {
    const client = useQueryClient()
    const query = useQuery({ queryKey: sessionGroupsKey, queryFn: () => api!.getGroups(), enabled: Boolean(api) })
    const mutation = useMutation({
        mutationFn: async (input: { id: string; patch: UpdateSessionGroup } | { name: string }) => {
            if (!api) throw new Error('API unavailable')
            return 'id' in input ? api.updateGroup(input.id, input.patch) : api.createGroup(input.name)
        },
        onSettled: () => client.invalidateQueries({ queryKey: sessionGroupsKey }),
    })
    return { groups: query.data?.groups ?? [], query, mutation }
}
