import { useSyncExternalStore } from 'react'

/**
 * Shared voice playback queue, modelled on Telegram: pressing play on a voice
 * (or audio) message queues every playable message of the chat and continues
 * into the next one when the current ends. The audio element lives outside the
 * React tree, so leaving the conversation never stops playback — a mini player
 * (VoiceMiniPlayer) takes over control until the chat is reopened.
 */
export type VoiceQueueItem = {
    // Matches MediaAttachment's seed: conversationId:providerMessageId:mediaIndex.
    key: string
    conversationId: string
    providerMessageId: string
    mediaIndex: number
    title: string
    chatTitle?: string
    duration: number | null
    // Object URL adopted from an already-preloaded MediaAttachment; the store
    // then owns its lifetime (see isVoicePlaybackOwnedUrl).
    src?: string
}

export type VoicePlaybackStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'failed'

export type VoicePlaybackState = {
    status: VoicePlaybackStatus
    queue: VoiceQueueItem[]
    index: number
    currentTime: number
    duration: number
    conversationId: string | null
}

export type VoiceBlobFetcher = (item: VoiceQueueItem) => Promise<Blob>

const idleState: VoicePlaybackState = {
    status: 'idle',
    queue: [],
    index: -1,
    currentTime: 0,
    duration: 0,
    conversationId: null
}

let state: VoicePlaybackState = idleState
const listeners = new Set<() => void>()

function setState(patch: Partial<VoicePlaybackState>): void {
    state = { ...state, ...patch }
    for (const listener of listeners) listener()
}

export function subscribeVoicePlayback(listener: () => void): () => void {
    listeners.add(listener)
    return () => {
        listeners.delete(listener)
    }
}

export function getVoicePlaybackState(): VoicePlaybackState {
    return state
}

export function useVoicePlayback(): VoicePlaybackState {
    return useSyncExternalStore(subscribeVoicePlayback, getVoicePlaybackState)
}

let audio: HTMLAudioElement | null = null
let fetchBlob: VoiceBlobFetcher | null = null
// Guards against a slow blob download of an old request landing after the
// user has already started something else.
let playToken = 0
const ownedUrls = new Set<string>()
// Adopted URLs the store has released again. A still-mounted MediaAttachment
// keeps the dead URL in its state and must refetch instead of replaying it.
const releasedUrls = new Set<string>()

// A detached element would play, but attaching it keeps iOS Safari happy and
// makes the store's element visible to the DOM-wide "pause other audio" sweep.
function ensureAudio(): HTMLAudioElement {
    if (audio) return audio
    audio = new Audio()
    audio.preload = 'auto'
    audio.style.display = 'none'
    document.body.append(audio)
    audio.addEventListener('play', () => setState({ status: 'playing' }))
    audio.addEventListener('timeupdate', () => {
        if (audio) setState({ currentTime: audio.currentTime })
    })
    audio.addEventListener('loadedmetadata', () => {
        if (audio && Number.isFinite(audio.duration) && audio.duration > 0) setState({ duration: audio.duration })
    })
    // Natural end also fires "pause" just before "ended"; only treat a pause
    // as user-visible while playback was actually running.
    audio.addEventListener('pause', () => {
        if (state.status === 'playing') setState({ status: 'paused' })
    })
    audio.addEventListener('ended', () => {
        void playNext()
    })
    audio.addEventListener('error', () => {
        if (audio?.error && state.status !== 'idle') setState({ status: 'failed' })
    })
    return audio
}

function pauseOtherDomAudio(current: HTMLAudioElement): void {
    for (const element of document.querySelectorAll('audio')) {
        if (element !== current) element.pause()
    }
}

function releaseUrl(url: string | undefined): void {
    if (!url || !ownedUrls.delete(url)) return
    releasedUrls.add(url)
    try {
        URL.revokeObjectURL(url)
    } catch {
    }
}

function clearAudioSource(element: HTMLAudioElement): void {
    element.removeAttribute('src')
    try {
        element.load()
    } catch {
    }
}

function stopInternal(): void {
    playToken += 1
    if (audio) {
        audio.pause()
        clearAudioSource(audio)
    }
    for (const url of ownedUrls) {
        releasedUrls.add(url)
        try {
            URL.revokeObjectURL(url)
        } catch {
        }
    }
    ownedUrls.clear()
    setState({ ...idleState })
}

export function stopVoicePlayback(): void {
    if (state.status === 'idle') return
    stopInternal()
}

async function playIndex(index: number): Promise<void> {
    const item = state.queue[index]
    if (!item || !fetchBlob) return
    const token = ++playToken
    setState({
        index,
        conversationId: item.conversationId,
        status: 'loading',
        currentTime: 0,
        duration: item.duration ?? 0
    })
    try {
        const url = item.src ?? URL.createObjectURL(await fetchBlob(item))
        if (token !== playToken) {
            // Superseded while downloading; nothing adopted this URL yet.
            if (!item.src) {
                try {
                    URL.revokeObjectURL(url)
                } catch {
                }
            }
            return
        }
        ownedUrls.add(url)
        // Write the URL back so advancing can release exactly this item's
        // blob, fetched or adopted.
        setState({ queue: state.queue.map((queueItem, itemIndex) => itemIndex === index ? { ...queueItem, src: url } : queueItem) })
        const element = ensureAudio()
        pauseOtherDomAudio(element)
        element.src = url
        await element.play()
        if (token === playToken) setState({ status: 'playing' })
    } catch {
        if (token === playToken) setState({ status: 'failed' })
    }
}

async function playNext(): Promise<void> {
    releaseUrl(state.queue[state.index]?.src)
    if (!state.queue[state.index + 1]) {
        stopInternal()
        return
    }
    await playIndex(state.index + 1)
}

/**
 * Starts (or replaces) the playback queue at `index`. `playedSrc` adopts an
 * object URL the calling MediaAttachment has already downloaded; the store
 * takes over its lifetime from there.
 */
export function startVoiceQueue(
    items: VoiceQueueItem[],
    index: number,
    fetcher: VoiceBlobFetcher,
    playedSrc?: string | null
): void {
    stopInternal()
    fetchBlob = fetcher
    setState({
        queue: items.map((item, itemIndex) => itemIndex === index && playedSrc ? { ...item, src: playedSrc } : item)
    })
    void playIndex(index)
}

export function toggleVoicePlayback(): void {
    const element = audio
    if (!element || state.index < 0) return
    if (state.status === 'failed') {
        void playIndex(state.index)
        return
    }
    if (element.paused) {
        pauseOtherDomAudio(element)
        void element.play().catch(() => setState({ status: 'failed' }))
    } else {
        element.pause()
    }
}

export function seekVoicePlayback(ratio: number): void {
    const element = audio
    if (!element || state.index < 0) return
    const total = Number.isFinite(element.duration) && element.duration > 0
        ? element.duration
        : state.duration
    if (!total) return
    element.currentTime = Math.min(1, Math.max(0, ratio)) * total
    setState({ currentTime: element.currentTime })
}

// True while the store owns this object URL; its donor (MediaAttachment) must
// then skip its own revoke-on-unmount or open chat playback would go silent.
export function isVoicePlaybackOwnedUrl(url: string | null): boolean {
    return url !== null && ownedUrls.has(url)
}

// True once the store has released an adopted URL; the donor must refetch
// instead of handing the dead URL back on the next play press.
export function isVoicePlaybackUrlReleased(url: string | null): boolean {
    return url !== null && releasedUrls.has(url)
}
