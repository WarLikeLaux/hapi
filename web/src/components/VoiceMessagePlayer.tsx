import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { ExternalMedia } from '@hapi/protocol/messengers'
import { cn } from '@/lib/utils'
import { formatRoundVideoTime } from '@/components/RoundVideoPlayer'

// Waveforms draw at a fixed bar count so the bubble is always filled edge to
// edge: provider data (up to ~100 Telegram bars) is peak-downsampled, and chat
// waveforms without provider data (e.g. audio files) get stable per-message
// bars with the same silhouette.
const WAVEFORM_BARS = 40

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

function pauseOtherAudio(current: HTMLAudioElement | null): void {
    for (const audio of document.querySelectorAll('audio')) {
        if (audio !== current) audio.pause()
    }
}

function PlayIcon() {
    return <svg viewBox="0 0 24 24" className="h-5 w-5 translate-x-px fill-current" aria-hidden="true"><path d="M8 5v14l11-7Z" /></svg>
}

function PauseIcon() {
    return <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current" aria-hidden="true"><path d="M6.5 5h4v14h-4zm7 0h4v14h-4z" /></svg>
}

export function VoiceMessagePlayer(props: {
    media: ExternalMedia
    seed: string
    src: string | null
    loading: boolean
    error: string | null
    label: string
    onLoad: () => void
    observerRef: (node: HTMLDivElement | null) => void
    overlay?: ReactNode
}) {
    const audioRef = useRef<HTMLAudioElement>(null)
    const wantsPlaybackRef = useRef(false)
    const [playing, setPlaying] = useState(false)
    const [failed, setFailed] = useState(false)
    const [currentTime, setCurrentTime] = useState(0)
    const [audioDuration, setAudioDuration] = useState(0)

    const bars = resampleWaveform(props.media.waveform?.length ? props.media.waveform : deterministicWaveform(props.seed))
    const totalDuration = props.media.duration ?? (audioDuration > 0 ? audioDuration : null)
    const progress = totalDuration ? Math.min(1, currentTime / totalDuration) : 0
    const fetching = !props.src && props.loading

    useEffect(() => {
        const audio = audioRef.current
        if (!audio || !props.src || !wantsPlaybackRef.current) return
        wantsPlaybackRef.current = false
        pauseOtherAudio(audio)
        void audio.play().catch(() => setFailed(true))
    }, [props.src])

    useEffect(() => () => {
        wantsPlaybackRef.current = false
        audioRef.current?.pause()
    }, [])

    const toggle = () => {
        const audio = audioRef.current
        if (!props.src) {
            setFailed(false)
            wantsPlaybackRef.current = true
            props.onLoad()
            return
        }
        if (!audio) return
        setFailed(false)
        if (audio.paused) {
            pauseOtherAudio(audio)
            void audio.play().catch(() => setFailed(true))
        } else {
            audio.pause()
        }
    }

    const seek = (event: React.MouseEvent<HTMLDivElement>) => {
        const audio = audioRef.current
        if (!audio || !props.src || !totalDuration) return
        const bounds = event.currentTarget.getBoundingClientRect()
        if (bounds.width <= 0) return
        const ratio = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width))
        audio.currentTime = ratio * totalDuration
        setCurrentTime(audio.currentTime)
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
                    className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[var(--app-link)] text-[var(--app-bg)] shadow-sm outline-none transition-transform not-disabled:active:scale-95 focus-visible:ring-2 focus-visible:ring-[var(--app-link)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--app-bg)]"
                >
                    {fetching
                        ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                        : failed
                            ? <span className="text-lg leading-none">↻</span>
                            : playing ? <PauseIcon /> : <PlayIcon />}
                </button>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div
                        className={cn('flex h-6 items-center gap-[2px]', props.src && !failed && 'cursor-pointer')}
                        onClick={seek}
                        role={props.src && !failed ? 'slider' : undefined}
                        aria-label="Playback position"
                        aria-valuenow={props.src && !failed ? Math.round(progress * 100) : undefined}
                        aria-valuemin={0}
                        aria-valuemax={100}
                    >
                        {bars.map((value, index) => (
                            <span
                                key={index}
                                className={cn(
                                    'min-w-0 max-w-[5px] flex-1 rounded-full',
                                    index < Math.round(progress * bars.length) ? 'bg-[var(--app-link)]' : 'bg-[var(--app-fg)] opacity-30'
                                )}
                                style={{ height: `${3 + Math.round((Math.min(value, 31) / 31) * 21)}px` }}
                            />
                        ))}
                    </div>
                    <span className={cn(
                        'truncate text-[11px] leading-none tabular-nums text-[var(--app-hint)]',
                        (props.error || failed) && 'text-red-600'
                    )}>{timeLabel}</span>
                </div>
            </div>
            <audio
                ref={audioRef}
                src={props.src ?? undefined}
                preload="auto"
                onPlay={() => {
                    setPlaying(true)
                    setFailed(false)
                }}
                onPause={() => setPlaying(false)}
                onEnded={(event) => {
                    setPlaying(false)
                    setCurrentTime(0)
                    event.currentTarget.currentTime = 0
                }}
                onError={() => {
                    setFailed(Boolean(props.src))
                    setPlaying(false)
                }}
                onLoadedMetadata={(event) => setAudioDuration(event.currentTarget.duration)}
                onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
            />
            {props.overlay}
        </div>
    )
}
