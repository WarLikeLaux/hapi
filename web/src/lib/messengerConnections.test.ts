import { describe, expect, it } from 'vitest'
import type { MessengerConnection } from '@hapi/protocol/messengers'
import { upsertMessengerConnection } from './messengerConnections'

function connection(provider: string, state: MessengerConnection['state']): MessengerConnection {
    return { provider, state, accountLabel: null, detail: null }
}

describe('upsertMessengerConnection', () => {
    it('keeps the query cache as an array when the first connector is configured', () => {
        expect(upsertMessengerConnection(undefined, connection('telegram', 'starting'))).toEqual([
            connection('telegram', 'starting')
        ])
    })

    it('updates one provider without discarding future messenger connectors', () => {
        const current = [
            connection('telegram', 'starting'),
            connection('signal', 'ready')
        ]

        expect(upsertMessengerConnection(current, connection('telegram', 'awaiting_phone'))).toEqual([
            connection('telegram', 'awaiting_phone'),
            connection('signal', 'ready')
        ])
    })
})
