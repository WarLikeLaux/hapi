import { useRef, useState } from 'react'

export function formatRoundVideoTime(value: number): string {
    if (!Number.isFinite(value) || value < 0) return '0:00'
    const seconds = Math.floor(value)
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

function PlayIcon() {
    return <svg viewBox="0 0 24 24" className="h-7 w-7 translate-x-px fill-current" aria-hidden="true"><path d="M8 5v14l11-7Z" /></svg>
}

function PauseIcon() {
    return <svg viewBox="0 0 24 24" className="h-7 w-7 fill-current" aria-hidden="true"><path d="M6.5 5h4v14h-4zm7 0h4v14h-4z" /></svg>
}

export function RoundVideoPlayer(props: { src: string; label?: string }) {
    const videoRef = useRef<HTMLVideoElement>(null)
    const [playing, setPlaying] = useState(false)
    const [waiting, setWaiting] = useState(true)
    const [failed, setFailed] = useState(false)
    const [currentTime, setCurrentTime] = useState(0)
    const [duration, setDuration] = useState(0)
    const progress = duration > 0 ? Math.min(1, currentTime / duration) : 0

    const togglePlayback = () => {
        const video = videoRef.current
        if (!video) return
        if (video.paused) {
            void video.play().catch(() => setFailed(true))
        } else {
            video.pause()
        }
    }

    const action = failed ? 'Retry video message' : playing ? 'Pause video message' : 'Play video message'

    return (
        <button
            type="button"
            onClick={togglePlayback}
            aria-label={props.label ? `${action}: ${props.label}` : action}
            className="group relative h-[min(14rem,72vw)] w-[min(14rem,72vw)] shrink-0 overflow-hidden rounded-full p-[3px] text-white shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--app-bg)]"
            style={{ background: `conic-gradient(var(--app-link) ${progress * 360}deg, color-mix(in srgb, var(--app-border) 76%, transparent) 0deg)` }}
        >
            <span className="absolute inset-[3px] overflow-hidden rounded-full bg-black">
                <video
                    ref={videoRef}
                    src={props.src}
                    playsInline
                    preload="auto"
                    className="h-full w-full object-cover"
                    onCanPlay={() => {
                        setWaiting(false)
                        setFailed(false)
                    }}
                    onWaiting={() => setWaiting(true)}
                    onPlaying={() => {
                        setPlaying(true)
                        setWaiting(false)
                    }}
                    onPause={() => setPlaying(false)}
                    onEnded={() => setPlaying(false)}
                    onError={() => {
                        setFailed(true)
                        setWaiting(false)
                        setPlaying(false)
                    }}
                    onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
                    onDurationChange={(event) => setDuration(event.currentTarget.duration)}
                    onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
                />
            </span>
            <span className="pointer-events-none absolute inset-0 grid place-items-center">
                <span className="grid h-12 w-12 place-items-center rounded-full bg-black/55 text-white shadow-md backdrop-blur-sm transition-colors group-hover:bg-black/70">
                    {waiting
                        ? <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/35 border-t-white" />
                        : failed
                            ? <span className="text-xl leading-none">↻</span>
                            : playing ? <PauseIcon /> : <PlayIcon />}
                </span>
            </span>
            <span className="pointer-events-none absolute bottom-5 left-1/2 -translate-x-1/2 rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-medium tabular-nums text-white shadow-sm backdrop-blur-sm">
                {formatRoundVideoTime(currentTime)} / {formatRoundVideoTime(duration)}
            </span>
        </button>
    )
}
