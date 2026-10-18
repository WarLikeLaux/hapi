import type { KeyboardEvent } from 'react'

export function submitQuestionAnswerOnEnter(event: KeyboardEvent<HTMLTextAreaElement>, submit: () => void): void {
    // keyCode covers browsers that report the IME confirmation as Enter after
    // compositionend, with isComposing already false.
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing || event.keyCode === 229) return
    event.preventDefault()
    event.stopPropagation()
    if (!event.repeat) submit()
}
