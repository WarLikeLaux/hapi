import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ExternalReaction } from '@hapi/protocol/messengers'
import { CopyIcon } from '@/components/icons'
import { useAnchoredMenu, type AnchoredMenuPoint } from '@/hooks/useAnchoredMenu'
import { safeCopyToClipboard } from '@/lib/clipboard'
import { useTranslation } from '@/lib/use-translation'
import { cn } from '@/lib/utils'

export function ChatsMessageMenu(props: {
    anchorPoint: AnchoredMenuPoint
    text: string
    reactions: ExternalReaction[]
    frequentReactions: readonly string[]
    allReactions: readonly string[]
    emojiFontFamily: string
    reactionsPending: boolean
    onClose: () => void
    onReply: () => void
    onEdit?: () => void
    onDelete?: () => void
    onReaction: (emoji: string) => void
}) {
    const { t } = useTranslation()
    const [expanded, setExpanded] = useState(false)
    const [copyFailed, setCopyFailed] = useState(false)
    // Re-measure the entire popup when the reaction grid or error changes its height.
    const anchorPoint = useMemo(() => ({ ...props.anchorPoint }), [props.anchorPoint, expanded, copyFailed])
    const { menuRef, menuStyle } = useAnchoredMenu({
        isOpen: true, onClose: props.onClose, anchorPoint, align: 'start',
    })
    const chosenCount = props.reactions.filter(reaction => reaction.chosen).length
    const itemClassName = 'flex min-h-10 w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--app-subtle-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)]'

    const copyText = async () => {
        try {
            await safeCopyToClipboard(props.text)
            props.onClose()
        } catch {
            setCopyFailed(true)
        }
    }

    return createPortal(
        <div
            ref={menuRef}
            className="fixed z-50 flex max-h-[calc(100dvh-16px)] max-w-[calc(100vw-16px)] flex-col items-center gap-2 overflow-y-auto text-[var(--app-fg)] animate-menu-pop"
            style={menuStyle}
            onContextMenu={(event) => event.preventDefault()}
            onKeyDown={(event) => {
                if (['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
                    event.preventDefault()
                    event.stopPropagation()
                    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
                    const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
                    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
                        : (index + (event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 1) + buttons.length) % buttons.length
                    buttons[next]?.focus()
                }
                // Let Space activate the focused button without the composer stealing it.
                if (event.key === ' ' || event.key === 'Enter') event.stopPropagation()
                if (event.key === 'Tab') props.onClose()
            }}
        >
            <div
                role="group"
                aria-label={t('chats.menu.reactions')}
                className={cn(
                    'border border-[var(--app-border)] bg-[var(--app-bg)] p-1.5 shadow-lg',
                    expanded ? 'grid w-72 max-w-full grid-cols-7 gap-1 rounded-2xl' : 'flex max-w-full items-center gap-1 rounded-full',
                )}
            >
                {(expanded ? props.allReactions : props.frequentReactions).map((emoji) => {
                    const chosen = props.reactions.some(reaction => reaction.reaction === `emoji:${emoji}` && reaction.chosen)
                    return (
                        <button
                            type="button"
                            key={emoji}
                            aria-label={t('chats.menu.react', { emoji })}
                            aria-pressed={chosen}
                            disabled={props.reactionsPending || (!chosen && chosenCount >= 3)}
                            className={cn(
                                'flex h-9 min-w-0 items-center justify-center overflow-hidden rounded-xl text-[22px] leading-none hover:bg-[var(--app-secondary-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)] disabled:opacity-30',
                                expanded ? 'w-full' : 'w-9 shrink-0',
                                chosen && 'bg-[#2AABEE]/15',
                            )}
                            style={{ fontFamily: props.emojiFontFamily }}
                            onClick={() => props.onReaction(emoji)}
                        >
                            <span className="block h-7 w-7 overflow-hidden text-center leading-7">{emoji}</span>
                        </button>
                    )
                })}
                <button
                    type="button"
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--app-secondary-bg)] text-[var(--app-hint)] hover:text-[var(--app-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)]"
                    onClick={() => setExpanded(current => !current)}
                    aria-label={t(expanded ? 'chats.menu.fewerReactions' : 'chats.menu.moreReactions')}
                    aria-expanded={expanded}
                >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={cn('h-5 w-5 transition-transform', expanded && 'rotate-180')} aria-hidden="true"><path d="m7 10 5 5 5-5" /></svg>
                </button>
            </div>
            <div
                role="menu"
                aria-label={t('chats.menu.actions')}
                className="w-44 max-w-full rounded-xl border border-[var(--app-border)] bg-[var(--app-bg)] p-1 shadow-lg"
            >
                <button type="button" role="menuitem" className={itemClassName} onClick={props.onReply}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5" aria-hidden="true"><path d="M9 14 4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 6 6v4" /></svg>
                    {t('chats.reply.action')}
                </button>
                {props.text.trim() ? (
                    <button type="button" role="menuitem" className={itemClassName} onClick={() => void copyText()}>
                        <span aria-hidden="true"><CopyIcon className="h-5 w-5" /></span>
                        {t('chats.menu.copyText')}
                    </button>
                ) : null}
                {props.onEdit ? (
                    <button type="button" role="menuitem" className={itemClassName} onClick={props.onEdit}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5" aria-hidden="true"><path d="m16 3 5 5-12 12H4v-5Z" /><path d="m14 5 5 5" /></svg>
                        {t('chats.edit.action')}
                    </button>
                ) : null}
                {props.onDelete ? (
                    <button type="button" role="menuitem" className={cn(itemClassName, 'text-red-600 dark:text-red-400')} onClick={props.onDelete}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7" /></svg>
                        {t('chats.delete.action')}
                    </button>
                ) : null}
                {copyFailed ? <div role="alert" className="px-3 py-2 text-sm text-red-600">{t('chats.menu.copyFailed')}</div> : null}
            </div>
        </div>,
        document.body,
    )
}
