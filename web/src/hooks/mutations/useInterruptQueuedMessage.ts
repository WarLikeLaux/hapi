import { useMutation } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import { markMessagesConsumed } from '@/lib/message-window-store'
import { useTranslation } from '@/lib/use-translation'
import { useToast } from '@/lib/toast-context'

/** Interrupt the current turn and reuse a saved prompt for the next turn. */
export function useInterruptQueuedMessage(api: ApiClient | null) {
    const { t } = useTranslation()
    const { addToast } = useToast()
    const reportFailure = (sessionId: string, error: string) => addToast({
        title: t('queuedMessages.interruptFailed'),
        body: error,
        sessionId,
        url: window.location.href,
    })

    return useMutation({
        mutationFn: async (input: { sessionId: string; messageId: string }) => {
            if (!api) throw new Error('API unavailable')
            return api.interruptMessage(input.sessionId, input.messageId)
        },
        onSuccess: (result, input) => {
            if (result.status === 'failed') {
                reportFailure(input.sessionId, result.error)
            } else if (result.status === 'invoked' && result.message.localId && typeof result.message.invokedAt === 'number') {
                markMessagesConsumed(input.sessionId, [result.message.localId], result.message.invokedAt)
            }
            // Interrupt success only changes order. The native user_input
            // receipt will remove the row from the queue after acceptance.
        },
        onError: (error, input) => reportFailure(input.sessionId, error instanceof Error ? error.message : ''),
    })
}
