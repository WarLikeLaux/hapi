import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ExternalMedia } from '@hapi/protocol/messengers'
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

function renderPlayer(overrides: Partial<Parameters<typeof VoiceMessagePlayer>[0]> = {}) {
    return render(
        <VoiceMessagePlayer
            media={media()}
            seed="telegram:user:1:42:0"
            src={null}
            loading={false}
            error={null}
            label="voice.ogg"
            onLoad={() => {}}
            observerRef={() => {}}
            {...overrides}
        />
    )
}

describe('VoiceMessagePlayer', () => {
    afterEach(() => vi.restoreAllMocks())

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

    it('requests the audio on first play and reports loading', () => {
        const onLoad = vi.fn()
        const first = renderPlayer({ onLoad })
        fireEvent.click(screen.getByRole('button', { name: 'Play: voice.ogg' }))
        expect(onLoad).toHaveBeenCalledTimes(1)
        first.unmount()

        renderPlayer({ onLoad, loading: true })
        expect(screen.getByRole('button', { name: 'Play: voice.ogg' })).toBeDisabled()
    })

    it('plays a loaded blob and pauses it on the next press', () => {
        const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
        const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockReturnValue(undefined)
        renderPlayer({ src: 'blob:voice' })
        const audio = document.querySelector('audio')!

        fireEvent.click(screen.getByRole('button', { name: 'Play: voice.ogg' }))
        expect(play).toHaveBeenCalledTimes(1)

        fireEvent.play(audio)
        vi.spyOn(audio, 'paused', 'get').mockReturnValue(false)
        fireEvent.click(screen.getByRole('button', { name: 'Pause: voice.ogg' }))
        expect(pause).toHaveBeenCalledTimes(1)
    })

    it('seeks when the waveform is clicked on a loaded player', () => {
        vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
        renderPlayer({ src: 'blob:voice', media: media({ duration: 100 }) })
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
