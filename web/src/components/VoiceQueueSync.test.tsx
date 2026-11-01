import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { VoiceMiniPlayer } from './VoiceMiniPlayer'
import { getVoicePlaybackState, startVoiceQueue, stopVoicePlayback, type VoiceQueueItem } from '@/chat/voicePlayback'
import { queryKeys } from '@/lib/query-keys'

vi.mock('@tanstack/react-router', () => ({ useLocation: () => ({ pathname: '/other' }), useNavigate: () => vi.fn() }))
const api = { getExternalMessages: vi.fn(), markExternalVoiceListened: vi.fn() }
vi.mock('@/lib/app-context', () => ({ useAppContext: () => ({ api }) }))

const voice = (id: string): VoiceQueueItem => ({ key: `c:${id}:0`, conversationId: 'c', providerMessageId: id, mediaIndex: 0, title: 'Voice message', duration: null })
const message = (id: string) => ({ providerMessageId: id, direction: 'incoming', media: [{ kind: 'voice' }] })

afterEach(() => { stopVoicePlayback(); vi.restoreAllMocks() })

describe('live voice queue', () => {
    it('continues through existing and newly arrived voices only while the queue is active', async () => {
        vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
        vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
        vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
        vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:voice')
        vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
        const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
        client.setQueryData(queryKeys.externalMessages('c'), { messages: [message('1'), message('2')], participants: [] })
        const fetch = vi.fn(async (_item: VoiceQueueItem) => new Blob(['voice']))
        const toggle = vi.fn(async () => {})
        render(<QueryClientProvider client={client}><VoiceMiniPlayer /></QueryClientProvider>)
        act(() => startVoiceQueue([voice('1'), voice('2')], 0, fetch, null, toggle))
        await waitFor(() => expect(getVoicePlaybackState().status).toBe('playing'))
        const audio = document.querySelector('audio')!
        act(() => fireEvent(audio, new Event('ended')))
        await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
        act(() => client.setQueryData(queryKeys.externalMessages('c'), { messages: [message('0'), message('1'), message('2'), message('3')], participants: [] }))
        await waitFor(() => expect(getVoicePlaybackState().queue.map(item => item.providerMessageId)).toEqual(['1', '2', '3']))
        act(() => fireEvent(audio, new Event('ended')))
        await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3))
        expect(fetch.mock.calls.map(([item]) => item.providerMessageId)).toEqual(['1', '2', '3'])
        expect(toggle).toHaveBeenCalledTimes(1)
        act(() => fireEvent(audio, new Event('ended')))
        await waitFor(() => expect(getVoicePlaybackState().status).toBe('idle'))
        await waitFor(() => expect(toggle).toHaveBeenCalledTimes(2))
        act(() => client.setQueryData(queryKeys.externalMessages('c'), { messages: [message('1'), message('2'), message('3'), message('4')], participants: [] }))
        expect(fetch).toHaveBeenCalledTimes(3)
        expect(getVoicePlaybackState().status).toBe('idle')
    })
})
