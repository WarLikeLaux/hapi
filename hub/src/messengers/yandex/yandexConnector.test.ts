import { describe, expect, it, spyOn } from 'bun:test'
import { RegistryClient } from './registry'
import { XivaClient } from './xivaClient'
import { buildMediaUrl, YandexConnector } from './yandexConnector'
import type { AttachmentRef } from './shapes'

describe('buildMediaUrl', () => {
    it('uses /file_shortterm for regular attachments (image, file, voice, gallery_image)', () => {
        for (const kind of ['image', 'file', 'voice', 'gallery_image'] as const) {
            const ref: AttachmentRef = { kind, fileId: 'bucket/abc-123' }
            expect(buildMediaUrl(ref)).toBe('https://files.messenger.yandex.ru/file_shortterm/bucket/abc-123?attach=true')
        }
    })

    it('uses the sticker path on the same host (no /file_shortterm/, no ?attach=true)', () => {
        const ref: AttachmentRef = { kind: 'sticker', fileId: 'stickers/images/2509/28331.png' }
        expect(buildMediaUrl(ref)).toBe('https://files.messenger.yandex.ru/stickers/images/2509/28331.png')
    })
})

// This boundary protects the chats-web edit/delete envelopes, including quoted
// replies and the required mutation acknowledgement, without hitting an account.
describe('Yandex message changes', () => {
    it('addresses the original message, preserves reply metadata, and rejects uncommitted changes', async () => {
        const timestamp = 1750000000000000
        const plain = {
            ChatId: 'chat', PayloadId: 'original', Text: { MessageText: 'Original' },
            ForwardedMessageRefs: [{ ChatId: 'chat', Timestamp: timestamp - 1 }],
            ForwardedMessageStyles: [{ Quote: 'Quoted text' }], UrlPreviewDisabled: true
        }
        let status = 1
        const mutations: Record<string, unknown>[] = []
        const identity = spyOn(RegistryClient.prototype, 'requestUser').mockResolvedValue({ guid: 'me', uid: '123' })
        const connect = spyOn(XivaClient.prototype, 'connect').mockResolvedValue(undefined)
        const subscription = spyOn(XivaClient.prototype, 'waitForSubscriptionId').mockResolvedValue('subscription')
        const request = spyOn(XivaClient.prototype, 'request').mockImplementation(async (method, params) => {
            if (method === 'history') return { Chats: [{ ChatId: 'chat', Messages: [{ ServerMessage: {
                ClientMessage: { Plain: plain },
                ServerMessageInfo: { Timestamp: timestamp, SeqNo: 1, Version: 1, From: { Guid: 'me' } }
            } }] }] }
            mutations.push(params!.ClientMessage as Record<string, unknown>)
            return { Status: status }
        })
        const connector = new YandexConnector({ namespace: 'owner', dataDir: '/tmp', onEvent: () => {} })
        try {
            await connector.configure({ cookies: 'yandexuid=123' })
            // Editing after restart must obtain the original body from history.
            await connector.editMessage('chat', String(timestamp), 'Corrected')
            expect(mutations[0]?.Plain).toMatchObject({
                ChatId: 'chat', Timestamp: timestamp, Text: { MessageText: 'Corrected' },
                ForwardedMessageRefs: plain.ForwardedMessageRefs,
                ForwardedMessageStyles: plain.ForwardedMessageStyles, UrlPreviewDisabled: true
            })
            await connector.deleteMessage('chat', String(timestamp))
            expect(mutations[1]?.Plain).toEqual({ ChatId: 'chat', Timestamp: timestamp })
            status = 0
            await expect(connector.editMessage('chat', String(timestamp), 'Rejected')).rejects.toThrow('did not accept')
            await expect(connector.deleteMessage('chat', String(timestamp))).rejects.toThrow('did not accept')
        } finally {
            await connector.stop()
            request.mockRestore()
            subscription.mockRestore()
            connect.mockRestore()
            identity.mockRestore()
        }
    })
})
