import gojoReady from '@/assets/gojo-ready.png'

/** A quiet, full-pane resting place when no conversation is selected. */
export function EmptyChat() {
    return (
        <div className="relative h-full min-h-0 w-full overflow-hidden bg-[#09152d]" aria-label="Satoru Gojo, ready to work">
            <img src={gojoReady} alt="" className="h-full w-full object-cover object-left" />
        </div>
    )
}
