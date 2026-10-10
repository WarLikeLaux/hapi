import { useEffect, useRef, useState, type ReactNode } from 'react'
import { LottieSticker } from './LottieSticker'
import { useAppContext } from '@/lib/app-context'

export function AnimatedEmoji(props: {
    emoji: string
    src: string | null
    conversationId: string
    providerMessageId: string
    effectIndex?: number
    overlay?: ReactNode
    observerRef: (node: HTMLDivElement | null) => void
}) {
    const { api } = useAppContext()
    const [replay, setReplay] = useState(0)
    const [effectSrc, setEffectSrc] = useState<string | null>(null)
    const [showEffect, setShowEffect] = useState(false)
    const loadingEffect = useRef(false)
    const mounted = useRef(true)
    const cachedEffect = useRef<string | null>(null)

    useEffect(() => {
        mounted.current = true
        return () => {
            mounted.current = false
            if (cachedEffect.current) URL.revokeObjectURL(cachedEffect.current)
        }
    }, [])

    const play = async () => {
        setReplay(value => value + 1)
        if (props.effectIndex === undefined || loadingEffect.current || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
        if (effectSrc) { setShowEffect(true); return }
        loadingEffect.current = true
        try {
            const blob = await api.getExternalMediaBlob(props.conversationId, props.providerMessageId, props.effectIndex)
            if (!mounted.current) return
            const src = URL.createObjectURL(blob)
            cachedEffect.current = src
            setEffectSrc(src)
            setShowEffect(true)
        } catch {
            // Replaying the emoji still works when its optional effect is unavailable.
        } finally { loadingEffect.current = false }
    }

    const fallback = <span className="absolute inset-0 flex items-center justify-center text-[7rem] leading-none">{props.emoji}</span>
    return <div ref={props.observerRef} className="relative w-fit max-w-full">
        <button type="button" aria-label={props.emoji} onClick={() => { void play() }} className="relative block h-40 w-40 cursor-pointer rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--app-link)]">
            {props.src ? <LottieSticker src={props.src} label={props.emoji} loop={false} replay={replay} fallback={fallback} className="h-full w-full" /> : fallback}
        </button>
        {effectSrc && showEffect ? <LottieSticker
            key={replay}
            src={effectSrc}
            label={props.emoji}
            loop={false}
            onComplete={() => setShowEffect(false)}
            className="pointer-events-none absolute bottom-0 left-1/2 z-20 h-[min(22rem,85vw)] w-[min(22rem,85vw)] -translate-x-1/2"
        /> : null}
        {props.overlay}
    </div>
}
