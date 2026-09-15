export function scrollFileLineToCenter(container: HTMLElement, target: HTMLElement): void {
    target.scrollIntoView({ block: 'center', inline: 'nearest' })

    // scrollIntoView may choose the outer app shell instead of this nested
    // viewport. Correct the file viewport explicitly after other ancestors.
    if (container.clientHeight <= 0 || container.scrollHeight <= container.clientHeight) return
    const containerRect = container.getBoundingClientRect()
    const targetRect = target.getBoundingClientRect()
    const centeredTop = container.scrollTop
        + targetRect.top
        - containerRect.top
        - ((container.clientHeight - targetRect.height) / 2)
    const maxScrollTop = container.scrollHeight - container.clientHeight
    container.scrollTop = Math.max(0, Math.min(centeredTop, maxScrollTop))
}
