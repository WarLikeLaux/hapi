import * as Popover from '@radix-ui/react-popover'
import { useQuery } from '@tanstack/react-query'
import { useId, useState } from 'react'
import type { YandexStickerPack } from '@hapi/protocol/messengers'
import { useAppContext } from '@/lib/app-context'
import { useTranslation } from '@/lib/use-translation'

export function YandexStickerPicker({ onSelect }: {
    onSelect: (sticker: YandexStickerPack['stickers'][number], setId: YandexStickerPack['id']) => boolean
}) {
    const { api } = useAppContext()
    const { t } = useTranslation()
    const [open, setOpen] = useState(false)
    const titleId = useId()
    const pack = useQuery({
        queryKey: ['yandex-sticker-pack'],
        queryFn: async () => (await api!.getYandexStickerPack()).pack,
        enabled: open && Boolean(api),
        staleTime: 5 * 60_000,
        retry: false
    })
    return (
        <Popover.Root open={open} onOpenChange={setOpen}>
            <Popover.Trigger asChild>
                <button
                    type="button"
                    disabled={!api}
                    title={t('chats.stickers.open')}
                    aria-label={t('chats.stickers.open')}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[var(--app-hint)] hover:bg-[var(--app-bg)] hover:text-[var(--app-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)] disabled:opacity-35"
                >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5" aria-hidden="true">
                        <path d="M20 13V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h7Z" />
                        <path d="M20 13h-5a2 2 0 0 0-2 2v5" />
                        <path d="M8 11a4 4 0 0 0 7 1M8 8h.01M15 8h.01" strokeLinecap="round" />
                    </svg>
                </button>
            </Popover.Trigger>
            <Popover.Portal>
                <Popover.Content
                    side="top"
                    align="start"
                    sideOffset={12}
                    collisionPadding={12}
                    aria-labelledby={titleId}
                    className="z-50 w-[min(20rem,calc(100vw-1.5rem))] max-h-[var(--radix-popover-content-available-height)] overflow-y-auto rounded-2xl bg-[var(--app-bg)] p-3 text-[var(--app-fg)] shadow-[0_8px_32px_rgba(0,0,0,0.24)]"
                >
                    <div className="mb-2 flex items-center justify-between gap-2">
                        <h2 id={titleId} className="truncate text-sm font-semibold">{pack.data?.title ?? 'Свинопасный'}</h2>
                        <Popover.Close asChild>
                            <button type="button" aria-label={t('button.close')} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--app-hint)] hover:bg-[var(--app-secondary-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)]">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg>
                            </button>
                        </Popover.Close>
                    </div>
                    {pack.isPending ? (
                        <div role="status" className="flex h-32 items-center justify-center text-sm text-[var(--app-hint)]">{t('common.loading')}</div>
                    ) : pack.isError ? (
                        <div role="alert" className="flex min-h-32 flex-col items-center justify-center gap-3 text-center text-sm">
                            <span>{t('chats.stickers.loadError')}</span>
                            <button type="button" disabled={pack.isFetching} onClick={() => void pack.refetch()} className="rounded-lg bg-[var(--app-secondary-bg)] px-3 py-2 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)] disabled:opacity-50">{t('button.retry')}</button>
                        </div>
                    ) : pack.data.stickers.length === 0 ? (
                        <div className="flex h-32 items-center justify-center text-sm text-[var(--app-hint)]">{t('chats.stickers.empty')}</div>
                    ) : (
                        <ul className="grid grid-cols-3 gap-1">
                            {pack.data.stickers.map((sticker, index) => (
                                <li key={sticker.id}>
                                    <button
                                        type="button"
                                        aria-label={`${t('chats.stickers.send')} ${sticker.text || index + 1}`}
                                        title={sticker.text || `${index + 1}`}
                                        onClick={() => {
                                            if (onSelect(sticker, pack.data.id)) setOpen(false)
                                        }}
                                        className="flex aspect-square w-full items-center justify-center rounded-lg p-1 hover:bg-[var(--app-secondary-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)]"
                                    >
                                        <StickerPreview sticker={sticker} />
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </Popover.Content>
            </Popover.Portal>
        </Popover.Root>
    )
}

function StickerPreview({ sticker }: { sticker: YandexStickerPack['stickers'][number] }) {
    const { t } = useTranslation()
    const [failed, setFailed] = useState(false)
    if (failed) {
        return <span className="flex h-full w-full flex-col items-center justify-center gap-1"><span className="text-2xl">{sticker.text}</span><span className="text-[10px] text-[var(--app-hint)]">{t('chats.stickers.previewUnavailable')}</span></span>
    }
    return <img src={`https://files.messenger.yandex.net/${sticker.id}`} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)} className="h-full w-full object-contain" />
}
