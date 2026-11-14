import type { ApiClient } from '@/api/client'
import { useSessionGroups } from '@/hooks/queries/useSessionGroups'
import { useToast } from '@/lib/toast-context'
import { useTranslation } from '@/lib/use-translation'

export function useGroupPin(api: ApiClient | null, sessionId: string) {
    const { groups, mutation } = useSessionGroups(api)
    const { addToast } = useToast()
    const { t } = useTranslation()
    const group = groups.find(item => item.members.some(member => member.sessionId === sessionId))
    const member = group?.members.find(item => item.sessionId === sessionId)
    return {
        pinned: member?.pinned ?? false,
        toggle: api && group && member && !mutation.isPending ? () => {
            void mutation.mutateAsync({ id: group.id, patch: { ...group, members: group.members.map(item => item.sessionId === sessionId ? { ...item, pinned: !item.pinned } : item) } })
                .catch(error => addToast({ title: t('groups.actionError'), body: error instanceof Error ? error.message : t('dialog.error.default'), sessionId, url: `/sessions/${sessionId}` }))
        } : undefined,
    }
}
