import { useLocation, useNavigate } from '@tanstack/react-router'
import { cn } from '@/lib/utils'
import { formatRoundVideoTime } from '@/components/RoundVideoPlayer'
import { stopVoicePlayback, toggleVoicePlayback, useVoicePlayback } from '@/chat/voicePlayback'

function PlayIcon() {
    return <svg viewBox="0 0 24 24" className="h-5 w-5 translate-x-px fill-current" aria-hidden="true"><path d="M8 5v14l11-7Z" /></svg>
}

function PauseIcon() {
    return <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current" aria-hidden="true"><path d="M6.5 5h4v14h-4zm7 0h4v14h-4z" /></svg>
}

// Telegram-style floating pill: once voice playback leaves the conversation it
// was started in, this keeps pause/stop/seek-to-chat available anywhere in the
// app. Hidden over the conversation that owns the queue — the bubbles there
// already show the same state.
function safeDecode(value: string): string {
    try {
        return decodeURIComponent(value)
    } catch {
        return value
    }
}

export function VoiceMiniPlayer() {
    const playback = useVoicePlayback()
    const navigate = useNavigate()
    const location = useLocation()
    const item = playback.index >= 0 ? playback.queue[playback.index] : undefined
    if (!item || playback.status === 'idle') return null
    // Route paths keep URI encoding (e.g. "telegram%3Auser%3A42") while queue
    // ids are decoded, so compare both.
    const paths = [`/chats/${item.conversationId}`, `/sessions/chats/${item.conversationId}`]
    if (paths.some((path) => location.pathname === path || safeDecode(location.pathname) === path)) return null

    const loading = playback.status === 'loading'
    const failed = playback.status === 'failed'
    const playing = playback.status === 'playing'
    const total = playback.duration > 0 ? playback.duration : item.duration
    const actionLabel = failed ? 'Retry' : playing ? 'Pause' : 'Play'

    return (
        <div
            className={cn(
                // Clears the bottom section nav on phones (safe-area aware).
                'fixed right-3 bottom-[calc(3.75rem+env(safe-area-inset-bottom))] z-40 flex max-w-[calc(100vw-1.5rem)] items-center gap-2 rounded-full border bg-[var(--app-secondary-bg)] py-1.5 pl-1.5 pr-2 shadow-lg',
                failed ? 'border-red-500/60' : 'border-[var(--app-border)]'
            )}
        >
            <button
                type="button"
                onClick={toggleVoicePlayback}
                disabled={loading}
                aria-label={`${actionLabel}: ${item.title}`}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--app-link)] text-[var(--app-bg)] shadow-sm outline-none transition-transform not-disabled:active:scale-95 focus-visible:ring-2 focus-visible:ring-[var(--app-link)]"
            >
                {loading
                    ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                    : failed
                        ? <span className="text-lg leading-none">↻</span>
                        : playing ? <PauseIcon /> : <PlayIcon />}
            </button>
            <button
                type="button"
                onClick={() => void navigate({ to: '/chats/$conversationId', params: { conversationId: item.conversationId } })}
                className="flex min-w-0 flex-col items-start gap-0.5 rounded-lg px-1 py-0.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)]"
            >
                <span className="max-w-[12rem] truncate text-xs leading-none font-medium sm:max-w-[16rem]">
                    {item.chatTitle ?? item.title}
                </span>
                <span className="text-[10px] leading-none tabular-nums text-[var(--app-hint)]">
                    {item.chatTitle && item.chatTitle !== item.title ? `${item.title} · ` : ''}
                    {formatRoundVideoTime(playback.currentTime)}{total ? ` / ${formatRoundVideoTime(total)}` : ''}
                </span>
            </button>
            <button
                type="button"
                onClick={stopVoicePlayback}
                aria-label="Stop playback"
                className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-[var(--app-hint)] outline-none hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)] focus-visible:ring-2 focus-visible:ring-[var(--app-link)]"
            >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
        </div>
    )
}
