import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExternalMedia } from '@hapi/protocol/messengers'
import { getVoicePlaybackState, startVoiceQueue, stopVoicePlayback, type VoiceQueueItem } from '@/chat/voicePlayback'
import { VoiceMessagePlayer } from './VoiceMessagePlayer'

function media(overrides: Partial<ExternalMedia> = {}): ExternalMedia {
    return {
        kind: 'voice',
        mimeType: 'audio/ogg',
        fileName: 'voice.ogg',
        size: 4096,
        thumbnailDataUrl: null,
        ...overrides
    }
}

function queueItem(overrides: Partial<VoiceQueueItem> = {}): VoiceQueueItem {
    return {
        key: 'conversation:m:0',
        conversationId: 'conversation',
        providerMessageId: 'm',
        mediaIndex: 0,
        title: 'voice.ogg',
        duration: null,
        ...overrides
    }
}

function renderPlayer(overrides: Partial<Parameters<typeof VoiceMessagePlayer>[0]> = {}) {
    const onStartPlayback = vi.fn()
    const view = render(
        <VoiceMessagePlayer
            media={media()}
            seed="conversation:m:0"
            src={null}
            loading={false}
            error={null}
            label="voice.ogg"
            observerRef={() => {}}
            onStartPlayback={onStartPlayback}
            {...overrides}
        />
    )
    return { onStartPlayback, ...view }
}

describe('VoiceMessagePlayer', () => {
    beforeEach(() => {
        vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
        vi.spyOn(HTMLMediaElement.prototype, 'pause').mockReturnValue(undefined)
        vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
        vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:created')
        vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    })

    afterEach(() => {
        stopVoicePlayback()
        vi.restoreAllMocks()
    })

    it('shows the provider duration and draws provider waveform bars', () => {
        renderPlayer({ src: 'blob:voice', media: media({ duration: 67, waveform: 'Aj8A' }) })

        expect(screen.getByText('1:07')).toBeInTheDocument()
        expect(screen.getByLabelText('Playback position').childNodes).toHaveLength(4)
    })

    it('falls back to stable synthetic bars and a label when metadata is missing', () => {
        renderPlayer()

        expect(screen.getByText('voice.ogg')).toBeInTheDocument()
        expect(screen.getByLabelText('Playback position').childNodes).toHaveLength(40)
    })

    it('downsamples long provider waveforms to the fixed bar count', () => {
        // 26 packed bytes decode to 41 bars — one over the fixed bar count.
        renderPlayer({ src: 'blob:voice', media: media({ waveform: btoa('ÿ'.repeat(26)) }) })

        expect(screen.getByLabelText('Playback position').childNodes).toHaveLength(40)
    })

    it('hands a first play to the shared queue, adopting an already-loaded src', () => {
        const first = renderPlayer({ src: 'blob:voice' })

        fireEvent.click(screen.getByRole('button', { name: 'Play: voice.ogg' }))
        expect(first.onStartPlayback).toHaveBeenCalledWith('blob:voice')
        first.unmount()

        renderPlayer({ loading: true })
        expect(screen.getByRole('button', { name: 'Play: voice.ogg' })).toBeDisabled()
    })

    it('mirrors the shared queue while its own message plays and pauses on press', async () => {
        startVoiceQueue([queueItem()], 0, async () => new Blob(['x']), 'blob:voice')
        await waitFor(() => expect(getVoicePlaybackState().status).toBe('playing'))
        renderPlayer({ src: 'blob:voice' })
        const audio = document.querySelector('audio')!
        vi.spyOn(audio, 'paused', 'get').mockReturnValue(false)

        expect(screen.getByRole('button', { name: 'Pause: voice.ogg' })).toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: 'Pause: voice.ogg' }))
        expect(audio.pause).toHaveBeenCalled()
    })

    it('seeks through the shared player when the waveform is clicked', async () => {
        startVoiceQueue([queueItem({ duration: 100 })], 0, async () => new Blob(['x']))
        await waitFor(() => expect(getVoicePlaybackState().status).toBe('playing'))
        renderPlayer()
        const audio = document.querySelector('audio')!
        const track = screen.getByLabelText('Playback position') as HTMLElement
        vi.spyOn(track, 'getBoundingClientRect').mockReturnValue({
            left: 0, width: 100, top: 0, height: 24, right: 100, bottom: 24, x: 0, y: 0, toJSON: () => ({})
        } as DOMRect)

        fireEvent.click(track, { clientX: 50 })
        expect(audio.currentTime).toBe(50)
        expect(screen.getByText('0:50')).toBeInTheDocument()
    })
})
