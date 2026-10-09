import { useEffect, useRef, useState } from 'react'
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
export function LottieSticker(props: { src: string; label: string; className?: string }) {
    const containerRef = useRef<HTMLDivElement>(null)
    const [failed, setFailed] = useState(false)

    useEffect(() => {
        const container = containerRef.current
        if (!container) return
        if (typeof DecompressionStream === 'undefined') {
            setFailed(true)
            return
        }
        let animation: AnimationItem | null = null
        let cancelled = false
        void (async () => {
            try {
                const [module, response] = await Promise.all([
                    loadLottieSvg(),
                    fetch(props.src)
                ])
                const gzipped = await response.arrayBuffer()
                const stream = new Blob([gzipped]).stream().pipeThrough(new DecompressionStream('gzip'))
                const animationData = await new Response(stream).json()
                if (cancelled) return
                animation = module.default.loadAnimation({
                    container,
                    renderer: 'svg',
                    loop: true,
                    autoplay: true,
                    animationData
                })
            } catch {
                if (!cancelled) setFailed(true)
            }
        })()
        return () => {
            cancelled = true
            animation?.destroy()
        }
    }, [props.src])

    if (failed) {
        return (
            <div className={props.className}>
                <div className="flex h-full w-full items-center justify-center gap-2 rounded-xl border border-[var(--app-border)] bg-[var(--app-subtle-bg)] px-3 text-sm">
                    <span className="text-base text-[var(--app-link)]">✦</span>
                    <span className="text-[var(--app-hint)]">{props.label}</span>
                </div>
            </div>
        )
    }
    return <div ref={containerRef} role="img" aria-label={props.label} className={props.className} />
}
