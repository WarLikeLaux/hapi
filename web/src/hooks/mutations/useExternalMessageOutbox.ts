import { skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import type { KlipyGif } from '@hapi/protocol/klipy'
import type { ExternalMessage, ExternalMessagesResponse } from '@hapi/protocol/messengers'
import type { ApiClient } from '@/api/client'
import { createOptimisticExternalMessage, getOptimisticExternalSender } from '@/chat/optimisticExternalMessages'
import { queryKeys } from '@/lib/query-keys'

type SendPayload = {
    text: string
    /** Provider message id to send this message as a reply to. */
    replyToProviderMessageId?: string
} & (
    | { kind: 'text' }
    | { kind: 'media'; file: File }
    | { kind: 'gif'; gif: KlipyGif }
)
type SendInput = SendPayload & { conversationId: string; clientId: string }

type OutboxEntry = {
    input: SendInput
    message: ExternalMessage
    status: 'sending' | 'failed' | 'sent'
    confirmedAfter?: number
    error?: string
}

const outboxKey = (conversationId: string) => ['external-message-outbox', conversationId] as const

export function useExternalMessageOutbox(
    api: ApiClient | null,
    conversationId: string,
    snapshot: { dataUpdatedAt: number; isSuccess: boolean },
) {
    const queryClient = useQueryClient()
    // Separate from server snapshots so SSE/refetches cannot drop pending or
    // failed sends. Retain their payloads when the operator switches chats.
    const outbox = useQuery<OutboxEntry[]>({
        queryKey: outboxKey(conversationId),
        queryFn: skipToken,
        initialData: [],
        enabled: false,
        gcTime: Infinity,
    })
    useEffect(() => {
        if (!snapshot.isSuccess || !outbox.data?.some((entry) => entry.status === 'sent'
            && snapshot.dataUpdatedAt > (entry.confirmedAfter ?? 0))) return
        queryClient.setQueryData<OutboxEntry[]>(outboxKey(conversationId), (entries) => entries?.filter((entry) =>
            entry.status !== 'sent' || snapshot.dataUpdatedAt <= (entry.confirmedAfter ?? 0)))
    }, [conversationId, outbox.data, queryClient, snapshot.dataUpdatedAt, snapshot.isSuccess])
    const pendingIds = useRef(new Set<string>())
    const update = (id: string, transform: (entries: OutboxEntry[]) => OutboxEntry[]) => {
        queryClient.setQueryData<OutboxEntry[]>(outboxKey(id), (entries) => transform(entries ?? []))
    }
    const mutation = useMutation({
        // Text, files and GIFs share the same delivery order. onMutate runs
        // immediately even for sends waiting behind another request.
        scope: { id: `external-send:${conversationId}` },
        mutationFn: async (input: SendInput) => {
            if (!api) throw new Error('API unavailable')
            if (input.kind === 'text') {
                await api.sendExternalMessage(input.conversationId, input.text, input.clientId, input.replyToProviderMessageId)
                return
            }
            let file: File
            if (input.kind === 'media') {
                file = input.file
            } else {
                const downloadUrl = input.gif.downloadUrl ?? input.gif.previewUrl
                if (!downloadUrl) throw new Error('KLIPY result has no downloadable URL')
                const extension = /\.webp(\?|$)/i.test(downloadUrl) ? 'webp'
                    : /\.mp4(\?|$)/i.test(downloadUrl) ? 'mp4' : 'gif'
                file = await api.downloadKlipyGifAsFile(downloadUrl, `klipy-${input.gif.id}.${extension}`)
            }
            if (file.size > 50 * 1024 * 1024) throw new Error('Media file must be 50 MB or smaller')
            await api.sendExternalMedia(input.conversationId, file, input.text, input.clientId, input.replyToProviderMessageId)
        },
        onMutate: (input) => {
            update(input.conversationId, (entries) => {
                const existing = entries.find((entry) => entry.input.clientId === input.clientId)
                if (existing) return entries.map((entry) => entry === existing
                    ? { ...entry, status: 'sending', error: undefined } : entry)
                const label = input.kind === 'media' ? input.file.name : input.kind === 'gif' ? 'GIF' : ''
                const message = createOptimisticExternalMessage({
                    conversationId: input.conversationId,
                    clientId: input.clientId,
                    text: [label, input.text].filter(Boolean).join('\n'),
                    replyToProviderMessageId: input.replyToProviderMessageId,
                    ...getOptimisticExternalSender(queryClient.getQueryData<ExternalMessagesResponse>(
                        queryKeys.externalMessages(input.conversationId),
                    )),
                })
                return [...entries, { input, message, status: 'sending' }]
            })
        },
        onSuccess: async (_, input) => {
            const confirmedAfter = queryClient.getQueryState(queryKeys.externalMessages(input.conversationId))?.dataUpdatedAt ?? 0
            update(input.conversationId, (entries) => entries.map((entry) => entry.input.clientId === input.clientId
                ? { ...entry, status: 'sent', confirmedAfter } : entry))
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: queryKeys.externalMessages(input.conversationId) }),
                queryClient.invalidateQueries({ queryKey: queryKeys.externalConversations }),
            ])
            // If refreshing failed, retain the acknowledged row without a
            // retry button until another successful refresh can replace it.
            if (queryClient.getQueryState(queryKeys.externalMessages(input.conversationId))?.status === 'success') {
                update(input.conversationId, (entries) => entries.filter((entry) => entry.status !== 'sent'))
            }
        },
        onError: (error, input) => {
            update(input.conversationId, (entries) => entries.map((entry) => entry.input.clientId === input.clientId
                ? { ...entry, status: 'failed', error: error.message } : entry))
        },
        onSettled: (_, __, input) => {
            pendingIds.current.delete(input.clientId)
        },
    })

    const send = (payload: SendPayload): boolean => {
        if (!api) return false
        const input = { ...payload, conversationId, clientId: crypto.randomUUID() }
        pendingIds.current.add(input.clientId)
        mutation.mutate(input)
        return true
    }
    const retry = (clientId: string) => {
        const entry = queryClient.getQueryData<OutboxEntry[]>(outboxKey(conversationId))
            ?.find((item) => item.input.clientId === clientId)
        if (!api || entry?.status !== 'failed' || pendingIds.current.has(clientId)) return
        pendingIds.current.add(clientId)
        mutation.mutate(entry.input)
    }

    return { entries: outbox.data ?? [], send, retry }
}
