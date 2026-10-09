import { fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
    getVoicePlaybackState,
    isVoicePlaybackOwnedUrl,
    isVoicePlaybackUrlReleased,
    startVoiceQueue,
    stopVoicePlayback,
    toggleVoicePlayback,
    type VoiceQueueItem
} from './voicePlayback'

function item(key: string, overrides: Partial<VoiceQueueItem> = {}): VoiceQueueItem {
    const parts = key.split(':')
    return {
        key,
        conversationId: parts[0]!,
        providerMessageId: parts[1]!,
        mediaIndex: Number(parts[2] ?? 0),
        title: `${key}.ogg`,
        duration: null,
        ...overrides
    }
}

function blobFetcher() {
    return vi.fn(async () => new Blob(['x']))
}

describe('voicePlayback queue', () => {
    beforeEach(() => {
        vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
        vi.spyOn(HTMLMediaElement.prototype, 'pause').mockReturnValue(undefined)
        vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
        let created = 0
        vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:${++created}`)
        vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    })

    afterEach(() => {
        stopVoicePlayback()
        vi.restoreAllMocks()
    })

    it('continues into the next message when one ends', async () => {
        const fetch = blobFetcher()
        startVoiceQueue([item('c:m:0'), item('c:m:1')], 0, fetch)
        await vi.waitFor(() => expect(getVoicePlaybackState().status).toBe('playing'))
        const audio = document.querySelector('audio')!

        fireEvent(audio, new Event('ended'))
        await vi.waitFor(() => expect(getVoicePlaybackState().status).toBe('playing'))
        expect(getVoicePlaybackState().index).toBe(1)
        expect(getVoicePlaybackState().queue[1].src).toBe('blob:2')
        expect(fetch).toHaveBeenCalledTimes(2)
    })

    it('stops and revokes everything after the last message', async () => {
        startVoiceQueue([item('c:m:0')], 0, blobFetcher())
        await vi.waitFor(() => expect(getVoicePlaybackState().status).toBe('playing'))

        fireEvent(document.querySelector('audio')!, new Event('ended'))
        await vi.waitFor(() => expect(getVoicePlaybackState().status).toBe('idle'))
        expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:1')
    })

    it('adopts a played src and reports it released after stopping', async () => {
        startVoiceQueue([item('c:m:0')], 0, blobFetcher(), 'blob:adopted')
        await vi.waitFor(() => expect(getVoicePlaybackState().status).toBe('playing'))
        expect(isVoicePlaybackOwnedUrl('blob:adopted')).toBe(true)
        expect(isVoicePlaybackUrlReleased('blob:adopted')).toBe(false)
        expect(document.querySelector('audio')!.src).toBe('blob:adopted')

        stopVoicePlayback()
        expect(isVoicePlaybackOwnedUrl('blob:adopted')).toBe(false)
        expect(isVoicePlaybackUrlReleased('blob:adopted')).toBe(true)
        expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:adopted')
    })

    it('marks a failed fetch and retries it from the toggle', async () => {
        const fetch = vi.fn<(item: VoiceQueueItem) => Promise<Blob>>()
            .mockRejectedValueOnce(new Error('offline'))
            .mockResolvedValue(new Blob(['x']))
        startVoiceQueue([item('c:m:0')], 0, fetch)
        await vi.waitFor(() => expect(getVoicePlaybackState().status).toBe('failed'))

        toggleVoicePlayback()
        await vi.waitFor(() => expect(getVoicePlaybackState().status).toBe('playing'))
        expect(fetch).toHaveBeenCalledTimes(2)
    })

    it('discards a superseded in-flight fetch and revokes its blob', async () => {
        let releaseFirst: ((blob: Blob) => void) | undefined
        const first = new Promise<Blob>((resolve) => { releaseFirst = resolve })
        const fetch = vi.fn<(item: VoiceQueueItem) => Promise<Blob>>()
            .mockImplementationOnce(() => first)
            .mockResolvedValue(new Blob(['x']))
        startVoiceQueue([item('c:m:0'), item('c:n:0')], 0, fetch)

        startVoiceQueue([item('c:n:0')], 0, fetch)
        await vi.waitFor(() => expect(getVoicePlaybackState().status).toBe('playing'))
        releaseFirst!(new Blob(['late']))
        await Promise.resolve()

        // The late blob of the replaced queue must neither play nor leak.
        expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:2')
        expect(getVoicePlaybackState().queue[0].key).toBe('c:n:0')
    })

    it('pauses and resumes through the toggle', async () => {
        startVoiceQueue([item('c:m:0')], 0, blobFetcher())
        await vi.waitFor(() => expect(getVoicePlaybackState().status).toBe('playing'))
        const audio = document.querySelector('audio')!
        const paused = vi.spyOn(audio, 'paused', 'get')

        paused.mockReturnValue(false)
        toggleVoicePlayback()
        expect(audio.pause).toHaveBeenCalled()
        fireEvent(audio, new Event('pause'))
        expect(getVoicePlaybackState().status).toBe('paused')

        paused.mockReturnValue(true)
        toggleVoicePlayback()
        expect(audio.play).toHaveBeenCalledTimes(2)
    })
})
