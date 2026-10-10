import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { AnimationItem } from 'lottie-web'

type LottieSvgModule = typeof import('lottie-web/build/player/lottie_svg')

let lottieSvgModule: Promise<LottieSvgModule> | null = null

function loadLottieSvg(): Promise<LottieSvgModule> {
    lottieSvgModule ??= import('lottie-web/build/player/lottie_svg')
    return lottieSvgModule
}

/**
 * Plays a Telegram animated sticker (.tgs — a gzipped Lottie JSON) in a
 * looping SVG animation. Falls back to a plain sticker tile when the browser
 * lacks DecompressionStream or the payload does not decompress.
 */
export function LottieSticker(props: { src: string; label: string; className?: string; loop?: boolean; replay?: number; fallback?: ReactNode; onComplete?: () => void }) {
    const containerRef = useRef<HTMLDivElement>(null)
    const animationRef = useRef<AnimationItem | null>(null)
    const onCompleteRef = useRef(props.onComplete)
    onCompleteRef.current = props.onComplete
    const [failed, setFailed] = useState(false)
    const [loaded, setLoaded] = useState(false)

    useEffect(() => {
        const container = containerRef.current
        if (!container) return
        setFailed(false)
        setLoaded(false)
        let animation: AnimationItem | null = null
        let cancelled = false
        let observer: IntersectionObserver | null = null
        const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
        let visible = true
        const updatePlayback = () => {
            if (!animation) return
            if (reducedMotion.matches) animation.goToAndStop(0, true)
            else if (!visible || document.hidden) animation.pause()
            else animation.play()
        }
        document.addEventListener('visibilitychange', updatePlayback)
        reducedMotion.addEventListener('change', updatePlayback)
        void (async () => {
            try {
                const [module, response] = await Promise.all([
                    loadLottieSvg(),
                    fetch(props.src)
                ])
                if (!response.ok) throw new Error('Animation unavailable')
                const bytes = new Uint8Array(await response.arrayBuffer())
                const gzipped = bytes[0] === 0x1f && bytes[1] === 0x8b
                const stream = new Blob([bytes]).stream()
                const animationData = await new Response(gzipped ? stream.pipeThrough(new DecompressionStream('gzip')) : stream).json()
                if (cancelled) return
                animation = module.default.loadAnimation({
                    container,
                    renderer: 'svg',
                    loop: props.loop ?? true,
                    autoplay: !reducedMotion.matches && !document.hidden,
                    animationData
                })
                animationRef.current = animation
                animation.addEventListener('DOMLoaded', () => { if (!cancelled) { setLoaded(true); updatePlayback() } })
                animation.addEventListener('complete', () => onCompleteRef.current?.())
                if (typeof IntersectionObserver !== 'undefined') {
                    observer = new IntersectionObserver(entries => { visible = entries.some(entry => entry.isIntersecting); updatePlayback() })
                    observer.observe(container)
                }
            } catch {
                if (!cancelled) setFailed(true)
            }
        })()
        return () => {
            cancelled = true
            animationRef.current = null
            observer?.disconnect()
            document.removeEventListener('visibilitychange', updatePlayback)
            reducedMotion.removeEventListener('change', updatePlayback)
            animation?.destroy()
        }
    }, [props.src, props.loop])

    useEffect(() => {
        if (props.replay && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) animationRef.current?.goToAndPlay(0, true)
    }, [props.replay])

    if (failed) {
        if (props.fallback) return <div className={props.className}>{props.fallback}</div>
        return (
            <div className={props.className}>
                <div className="flex h-full w-full items-center justify-center gap-2 rounded-xl border border-[var(--app-border)] bg-[var(--app-subtle-bg)] px-3 text-sm">
                    <span className="text-base text-[var(--app-link)]">✦</span>
                    <span className="text-[var(--app-hint)]">{props.label}</span>
                </div>
            </div>
        )
    }
    return <div role="img" aria-label={props.label} className={props.className}>
        {!loaded ? props.fallback : null}
        <div ref={containerRef} className="h-full w-full" />
    </div>
}
