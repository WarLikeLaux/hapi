import type { ReactNode } from 'react'
import type { ExternalMedia } from '@hapi/protocol/messengers'
import { cn } from '@/lib/utils'
import { formatRoundVideoTime } from '@/components/RoundVideoPlayer'
import { isVoicePlaybackUrlReleased, seekVoicePlayback, toggleVoicePlayback, useVoicePlayback } from '@/chat/voicePlayback'

// Waveforms draw at a fixed bar count so the bubble is always filled edge to
// edge: provider data (up to ~100 Telegram bars) is peak-downsampled, and chat
// waveforms without provider data (e.g. audio files) get stable per-message
// bars with the same silhouette.
const WAVEFORM_BARS = 40

// Telegram packs voice waveforms as 5-bit amplitudes back-to-back — 8 values
// in every 5 bytes — and the connector forwards them base64-encoded.
function decodeWaveform(encoded: string): number[] {
    const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0))
    const bars: number[] = []
    for (let index = 0; index < Math.floor((bytes.length * 8) / 5); index += 1) {
        const bitOffset = index * 5
        const byteIndex = Math.floor(bitOffset / 8)
        const shift = bitOffset % 8
        let value = bytes[byteIndex]! >> shift
        if (shift > 3 && byteIndex + 1 < bytes.length) value |= bytes[byteIndex + 1]! << (8 - shift)
        bars.push(value & 0x1f)
    }
    return bars
}

function resampleWaveform(values: number[]): number[] {
    if (values.length <= WAVEFORM_BARS) return values
    const bars: number[] = []
    const chunkSize = values.length / WAVEFORM_BARS
    for (let index = 0; index < WAVEFORM_BARS; index += 1) {
        const start = Math.floor(index * chunkSize)
        const end = Math.max(start + 1, Math.floor((index + 1) * chunkSize))
        bars.push(Math.max(...values.slice(start, end)))
    }
    return bars
}

function deterministicWaveform(seed: string): number[] {
    let hash = 0
    for (const character of seed) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0
    const bars: number[] = []
    let state = Math.abs(hash) || 1
    for (let index = 0; index < WAVEFORM_BARS; index += 1) {
        state = (state * 48271) % 2147483647
        bars.push(4 + (state % 24))
    }
    return bars
}

function PlayIcon() {
    return <svg viewBox="0 0 24 24" className="h-5 w-5 translate-x-px fill-current" aria-hidden="true"><path d="M8 5v14l11-7Z" /></svg>
}

function PauseIcon() {
    return <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current" aria-hidden="true"><path d="M6.5 5h4v14h-4zm7 0h4v14h-4z" /></svg>
}

// Audio itself is owned by the shared queue in @/chat/voicePlayback, so this
// is a pure view: it mirrors the queue state while its own message plays and
// hands every press over to the queue otherwise. Unmounting (leaving the
// chat) therefore never stops playback.
export function VoiceMessagePlayer(props: {
    media: ExternalMedia
    seed: string
    src: string | null
    loading: boolean
    error: string | null
    label: string
    observerRef: (node: HTMLDivElement | null) => void
    onStartPlayback: (src: string | null) => void
    overlay?: ReactNode
}) {
    const playback = useVoicePlayback()
    const current = playback.index >= 0 ? playback.queue[playback.index] : undefined
    const isCurrent = current?.key === props.seed
    const playing = isCurrent && playback.status === 'playing'
    const failed = isCurrent && playback.status === 'failed'
    const currentTime = isCurrent ? playback.currentTime : 0

    const bars = resampleWaveform(props.media.waveform ? decodeWaveform(props.media.waveform) : deterministicWaveform(props.seed))
    const totalDuration = props.media.duration ?? (isCurrent && playback.duration > 0 ? playback.duration : null)
    const progress = totalDuration ? Math.min(1, currentTime / totalDuration) : 0
    const fetching = (isCurrent && playback.status === 'loading') || (!props.src && props.loading)

    const toggle = () => {
        if (isCurrent) {
            toggleVoicePlayback()
            return
        }
        // A URL the queue has already released is dead; pass null so it
        // refetches the (HTTP-cached) blob instead.
        props.onStartPlayback(isVoicePlaybackUrlReleased(props.src) ? null : props.src)
    }

    const seek = (event: React.MouseEvent<HTMLDivElement>) => {
        if (!isCurrent || !totalDuration) return
        const bounds = event.currentTarget.getBoundingClientRect()
        if (bounds.width <= 0) return
        const ratio = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width))
        seekVoicePlayback(ratio)
    }

    const actionLabel = failed ? 'Retry' : playing ? 'Pause' : 'Play'
    const timeLabel = props.error
        ? props.error
        : currentTime > 0
            ? formatRoundVideoTime(currentTime)
            : totalDuration
                ? formatRoundVideoTime(totalDuration)
                : props.label

    return (
        <div ref={props.observerRef} className="relative w-[min(72vw,16rem)]">
            <div className={cn(
                'flex items-center gap-2.5 rounded-2xl bg-[var(--app-secondary-bg)] py-2 pl-2 pr-3',
                (props.error || failed) && 'border border-red-500/60'
            )}>
                <button
                    type="button"
                    onClick={toggle}
                    disabled={fetching}
                    aria-label={`${actionLabel}: ${props.label}`}
                    className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[var(--app-voice-accent,var(--app-link))] text-[var(--app-voice-button-fg,var(--app-bg))] shadow-sm outline-none transition-transform not-disabled:active:scale-95 focus-visible:ring-2 focus-visible:ring-[var(--app-link)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--app-bg)]"
                >
                    {fetching
                        ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                        : failed
                            ? <span className="text-lg leading-none">↻</span>
                            : playing ? <PauseIcon /> : <PlayIcon />}
                </button>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div
                        className={cn('flex h-6 items-center gap-[2px]', isCurrent && 'cursor-pointer')}
                        onClick={seek}
                        role={isCurrent ? 'slider' : undefined}
                        aria-label="Playback position"
                        aria-valuenow={isCurrent ? Math.round(progress * 100) : undefined}
                        aria-valuemin={0}
                        aria-valuemax={100}
                    >
                        {bars.map((value, index) => (
                            <span
                                key={index}
                                className={cn(
                                    'min-w-0 max-w-[5px] flex-1 rounded-full',
                                    index < Math.round(progress * bars.length) ? 'bg-[var(--app-voice-wave-played,var(--app-link))]' : 'bg-[var(--app-voice-wave,var(--app-fg))] opacity-[var(--app-voice-wave-opacity,0.3)]'
                                )}
                                style={{ height: `${3 + Math.round((Math.min(value, 31) / 31) * 21)}px` }}
                            />
                        ))}
                    </div>
                    <span className={cn(
                        'truncate text-[11px] leading-none tabular-nums text-[var(--app-voice-hint,var(--app-hint))]',
                        (props.error || failed) && 'text-red-600'
                    )}>{timeLabel}</span>
                </div>
            </div>
            {props.overlay}
        </div>
    )
}
