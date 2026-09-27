import { describe, expect, it } from 'bun:test'
import { reactionTypeForEmoji } from './reactionMap'
import {
    buildHistoryParams,
    normalizeChatElement,
    normalizeMessageItem,
    sortMessagesAscending
} from './shapes'

const MY_GUID = 'aaaaaaaa-1111-2222-3333-444444444444'
const PEER_GUID = 'dddddddd-1111-2222-3333-444444444444'

function textMessage(input: {
    micros: string
    text: string
    fromGuid?: string
    seqNo?: number
    deleted?: boolean
    lastEdit?: number
}): Record<string, unknown> {
    return {
        ServerMessage: {
            ClientMessage: { Plain: { Text: { MessageText: input.text } } },
            ServerMessageInfo: {
                Timestamp: input.micros,
                SeqNo: input.seqNo ?? 1,
                From: { Guid: input.fromGuid ?? PEER_GUID, DisplayName: 'Sender' },
                ...(input.lastEdit !== undefined ? { LastEditTimestamp: input.lastEdit } : {}),
                ...(input.deleted === true ? { Deleted: true } : {})
            }
        }
    }
}

describe('yandex shapes: message item', () => {
    it('normalizes an incoming text message', () => {
        const shaped = normalizeMessageItem(
            textMessage({ micros: '1750000000000000', text: 'Привет', seqNo: 4 }),
            MY_GUID,
            'chat-1'
        )
        expect(shaped).toBeDefined()
        expect(shaped!.message).toEqual(expect.objectContaining({
            id: 'yandex:chat-1:1750000000000000',
            conversationId: 'yandex:chat-1',
            providerMessageId: '1750000000000000',
            direction: 'incoming',
            text: 'Привет',
            senderName: 'Sender',
            createdAt: 1750000000000,
            editedAt: null
        }))
        expect(shaped!.message.deliveryStatus).toBeUndefined()
        expect(shaped!.micros).toBe(1750000000000000n)
    })

    it('derives outgoing delivery status from the peer seen sequence', () => {
        const read = normalizeMessageItem(
            textMessage({ micros: '1750000000000001', text: 'ok', fromGuid: MY_GUID, seqNo: 3 }),
            MY_GUID,
            'chat-1',
            5
        )
        expect(read!.message.deliveryStatus).toBe('read')

        const sent = normalizeMessageItem(
            textMessage({ micros: '1750000000000002', text: 'ok', fromGuid: MY_GUID, seqNo: 9 }),
            MY_GUID,
            'chat-1',
            5
        )
        expect(sent!.message.deliveryStatus).toBe('sent')
    })

    it('carries LastEditTimestamp as editedAt in milliseconds', () => {
        const shaped = normalizeMessageItem(
            textMessage({ micros: '1750000000000003', text: 'edit', lastEdit: 1750000001000000 }),
            MY_GUID,
            'chat-1'
        )
        expect(shaped!.message.editedAt).toBe(1750000001000)
    })

    it('skips deleted, system, and content-less items', () => {
        expect(normalizeMessageItem(
            textMessage({ micros: '1', text: 'gone', deleted: true }), MY_GUID, 'chat-1'
        )).toBeUndefined()
        expect(normalizeMessageItem({
            ServerMessage: {
                ClientMessage: { SystemMessage: {} },
                ServerMessageInfo: { Timestamp: '1', SeqNo: 1, From: { Guid: PEER_GUID, DisplayName: 'S' } }
            }
        }, MY_GUID, 'chat-1')).toBeUndefined()
        expect(normalizeMessageItem({
            ServerMessage: {
                ClientMessage: { Plain: {} },
                ServerMessageInfo: { Timestamp: '1', SeqNo: 1, From: { Guid: PEER_GUID, DisplayName: 'S' } }
            }
        }, MY_GUID, 'chat-1')).toBeUndefined()
    })

    it('extracts image, voice, gallery, and poll media', () => {
        const image = normalizeMessageItem({
            ServerMessage: {
                ClientMessage: { Plain: { Image: { FileInfo: { Id2: 'bucket/uuid-1', Name: 'pic.jpg', Size: 123 } } } },
                ServerMessageInfo: { Timestamp: '10', SeqNo: 1, From: { Guid: PEER_GUID, DisplayName: 'S' } }
            }
        }, MY_GUID, 'chat-1')
        expect(image!.attachments).toEqual([{ kind: 'image', fileId: 'bucket/uuid-1', name: 'pic.jpg', size: 123 }])
        expect(image!.message.media).toEqual([
            expect.objectContaining({ kind: 'image', fileName: 'pic.jpg', size: 123 })
        ])

        const voice = normalizeMessageItem({
            ServerMessage: {
                ClientMessage: { Plain: { Voice: { FileInfo: { Id2: 'bucket/uuid-2' }, Text: 'расшифровка' } } },
                ServerMessageInfo: { Timestamp: '20', SeqNo: 2, From: { Guid: PEER_GUID, DisplayName: 'S' } }
            }
        }, MY_GUID, 'chat-1')
        expect(voice!.message.text).toBe('расшифровка')
        expect(voice!.message.media![0]).toEqual(expect.objectContaining({ kind: 'voice' }))

        const gallery = normalizeMessageItem({
            ServerMessage: {
                ClientMessage: {
                    Plain: {
                        Gallery: {
                            Text: 'caption',
                            Items: [
                                { Image: { FileInfo: { Id2: 'bucket/g1' } } },
                                { Image: { FileInfo: { Id2: 'bucket/g2' } } }
                            ]
                        }
                    }
                },
                ServerMessageInfo: { Timestamp: '30', SeqNo: 3, From: { Guid: PEER_GUID, DisplayName: 'S' } }
            }
        }, MY_GUID, 'chat-1')
        expect(gallery!.message.text).toBe('caption')
        expect(gallery!.attachments.map((ref) => ref.fileId)).toEqual(['bucket/g1', 'bucket/g2'])
        expect(gallery!.message.media).toHaveLength(2)

        const poll = normalizeMessageItem({
            ServerMessage: {
                ClientMessage: { Plain: { Poll: {} } },
                ServerMessageInfo: { Timestamp: '40', SeqNo: 4, From: { Guid: PEER_GUID, DisplayName: 'S' } }
            }
        }, MY_GUID, 'chat-1')
        expect(poll!.message.media![0]).toEqual(expect.objectContaining({ kind: 'poll' }))
    })

    it('maps aggregate reactions and marks my own as chosen', () => {
        const shaped = normalizeMessageItem({
            ServerMessage: {
                ClientMessage: { Plain: { Text: { MessageText: 'with reactions' } } },
                ServerMessageInfo: { Timestamp: '50', SeqNo: 5, From: { Guid: PEER_GUID, DisplayName: 'S' } }
            },
            Reactions: [{ Type: 128077, Count: 3 }],
            RecentUserReactions: [{ Type: 128077, UserInfo: { Guid: MY_GUID } }]
        }, MY_GUID, 'chat-1')
        expect(shaped!.message.reactions).toEqual([
            { reaction: '👍', emoji: '👍', count: 3, chosen: true }
        ])
        expect(shaped!.chosenReactionTypes).toEqual([128077])
    })
})

describe('yandex shapes: chat element', () => {
    it('normalizes a private chat with unread and preview', () => {
        const shaped = normalizeChatElement({
            ChatId: 'g1_g2',
            PartnerInfo: { DisplayName: 'Алиса' },
            PrivateChatInfo: {},
            LastSeqNo: 7,
            LastSeenByMeSeqNo: 4,
            LastTsMcs: '1750000000000000',
            Messages: [textMessage({ micros: '1750000000000000', text: 'Привет' })]
        }, MY_GUID)
        expect(shaped!.conversation).toEqual(expect.objectContaining({
            id: 'yandex:g1_g2',
            provider: 'yandex',
            remoteId: 'g1_g2',
            title: 'Алиса',
            kind: 'direct',
            unreadCount: 3,
            lastMessageAt: 1750000000000,
            lastMessagePreview: 'Привет',
            selected: false
        }))
    })

    it('recognizes the saved-messages self gate', () => {
        const shaped = normalizeChatElement({
            ChatId: `${MY_GUID}_${MY_GUID}`,
            LastSeqNo: 1,
            LastSeenByMeSeqNo: 1,
            LastTsMcs: '1750000000000000'
        }, MY_GUID)
        expect(shaped!.conversation.kind).toBe('saved')
        expect(shaped!.conversation.title).toBe('Избранное')
    })

    it('normalizes a group chat', () => {
        const shaped = normalizeChatElement({
            ChatId: 'c1',
            ChatInfo: { Name: 'Команда' },
            LastSeqNo: 0,
            LastSeenByMeSeqNo: 0,
            LastTsMcs: '1750000000000000'
        }, MY_GUID)
        expect(shaped!.conversation).toEqual(expect.objectContaining({ kind: 'group', title: 'Команда' }))
    })

    it('picks a PartnerInfo AvatarId onto the yapic host for direct chats', () => {
        const shaped = normalizeChatElement({
            ChatId: 'g1_g2',
            PartnerInfo: { DisplayName: 'Алиса', AvatarId: 'user_avatar/yapic/1/abc-123' },
            PrivateChatInfo: {},
            LastSeqNo: 1,
            LastSeenByMeSeqNo: 1,
            LastTsMcs: '1750000000000000'
        }, MY_GUID)
        expect(shaped!.conversation.avatarDataUrl)
            .toBe('https://avatars.mds.yandex.net/get-yapic/1/abc-123/SMALL48')
    })

    it('routes an mssngr-namespaced AvatarId to the mssngr host', () => {
        const shaped = normalizeChatElement({
            ChatId: 'g1_g2',
            PartnerInfo: { DisplayName: 'Алиса', AvatarId: 'user_avatar/mssngr/1/abc-123' },
            PrivateChatInfo: {},
            LastSeqNo: 1,
            LastSeenByMeSeqNo: 1,
            LastTsMcs: '1750000000000000'
        }, MY_GUID)
        expect(shaped!.conversation.avatarDataUrl)
            .toBe('https://avatars.mds.yandex.net/get-mssngr/1/abc-123/SMALL48')
    })

    it('uses ChatInfo.AvatarUrl as-is for group chats', () => {
        const shaped = normalizeChatElement({
            ChatId: '0/0/c1',
            ChatInfo: {
                Name: 'Команда',
                AvatarUrl: 'https://files.messenger.yandex.net/group/c1/avatar?size=SMALL48'
            },
            LastSeqNo: 1,
            LastSeenByMeSeqNo: 1,
            LastTsMcs: '1750000000000000'
        }, MY_GUID)
        expect(shaped!.conversation.avatarDataUrl)
            .toBe('https://files.messenger.yandex.net/group/c1/avatar?size=SMALL48')
    })

    it('leaves avatarDataUrl null when neither PartnerInfo nor ChatInfo carries one', () => {
        const shaped = normalizeChatElement({
            ChatId: 'g1_g2',
            PartnerInfo: { DisplayName: 'Алиса' },
            PrivateChatInfo: {},
            LastSeqNo: 1,
            LastSeenByMeSeqNo: 1,
            LastTsMcs: '1750000000000000'
        }, MY_GUID)
        expect(shaped!.conversation.avatarDataUrl).toBeNull()
    })

    it('rejects an element without a ChatId', () => {
        expect(normalizeChatElement({ LastSeqNo: 1 }, MY_GUID)).toBeUndefined()
    })
})

describe('yandex shapes: helpers', () => {
    it('sorts messages ascending by microsecond mark', () => {
        const later = normalizeMessageItem(textMessage({ micros: '200', text: 'later' }), MY_GUID, 'c')
        const earlier = normalizeMessageItem(textMessage({ micros: '100', text: 'earlier' }), MY_GUID, 'c')
        const sorted = sortMessagesAscending([later!, earlier!])
        expect(sorted.map((message) => message.message.text)).toEqual(['earlier', 'later'])
    })

    it('builds history params', () => {
        expect(buildHistoryParams({ limit: 50 })).toEqual({ Limit: 50 })
        expect(buildHistoryParams({ chatId: 'g1_g2', limit: 100 })).toEqual({ Limit: 100, ChatId: 'g1_g2' })
        expect(buildHistoryParams({ limit: 1, maxTimestamp: 1750000000000000n }))
            .toEqual({ Limit: 1, MaxTimestamp: 1750000000000000 })
        expect(buildHistoryParams({ limit: 1, withChatData: true }))
            .toEqual({ Limit: 1, ChatDataFilter: {} })
    })
})

describe('yandex reactions: emoji mapping', () => {
    it('prefers the extended set for aliased emoji', () => {
        expect(reactionTypeForEmoji('👍')).toBe(100102)
        expect(reactionTypeForEmoji('❤️')).toBe(100109)
    })

    it('resolves mapped and codepoint-fallback emoji', () => {
        expect(reactionTypeForEmoji('🥱')).toBe(129393)
        // A unicode emoji our table never saw gets its own codepoint as the wire type.
        const unicorn = '🦄'.codePointAt(0)!
        expect(reactionTypeForEmoji('🦄')).toBe(unicorn)
        expect(reactionTypeForEmoji('a')).toBeNull()
    })
})
