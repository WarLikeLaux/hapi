import { useEffect, useMemo, useState, type ChangeEvent } from 'react'
import type { KlipyGif } from '@hapi/protocol/klipy'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { useAppContext } from '@/lib/app-context'
import { useKlipyAvailability, useKlipyCategories, useKlipySearch, useKlipyTrending } from '@/hooks/queries/useKlipy'
import { useTranslation } from '@/lib/use-translation'

/**
 * GIF picker dialog. The hub proxies KLIPY so the partner key never reaches
 * the browser. When the hub has no `KLIPY_API_KEY`, `useKlipyAvailability`
 * returns a 503-flavoured error and we hide the picker entirely instead of
 * showing a broken UI.
 *
 * Sending the selected GIF goes through the same `sendExternalMedia` path the
 * chat composer already uses for clipboard images and file-picker drops — the
 * GIF just shows up as another image attachment.
 */
type KlipyGifPickerProps = {
    open: boolean
    onOpenChange: (open: boolean) => void
    onSelect: (gif: KlipyGif) => void | Promise<void>
    isSending?: boolean
}

const DEFAULT_PER_PAGE = 18
const SEARCH_DEBOUNCE_MS = 250

export function KlipyGifPicker(props: KlipyGifPickerProps) {
    const { open, onOpenChange, onSelect, isSending } = props
    const { t } = useTranslation()
    const [query, setQuery] = useState('')
    const [debouncedQuery, setDebouncedQuery] = useState('')
    const [selectedCategory, setSelectedCategory] = useState<string | null>(null)

    // Debounce so the user does not flood the hub with a request per keystroke.
    useEffect(() => {
        const handle = setTimeout(() => setDebouncedQuery(query.trim()), SEARCH_DEBOUNCE_MS)
        return () => clearTimeout(handle)
    }, [query])

    // Reset the category whenever the picker re-opens.
    useEffect(() => {
        if (!open) {
            setQuery('')
            setDebouncedQuery('')
            setSelectedCategory(null)
        }
    }, [open])

    const availability = useKlipyAvailability({ enabled: open })
    const isConfigured = availability.isSuccess

    const categories = useKlipyCategories({ enabled: open })
    const trimmedQuery = debouncedQuery
    const isCategorySearch = trimmedQuery.length === 0 && selectedCategory !== null
    const searchTerm = isCategorySearch ? selectedCategory! : trimmedQuery

    const trending = useKlipyTrending({ perPage: DEFAULT_PER_PAGE, enabled: open && searchTerm.length === 0 })
    const search = useKlipySearch({ q: searchTerm, perPage: DEFAULT_PER_PAGE, enabled: open && searchTerm.length > 0 })

    const activeQuery = searchTerm.length > 0 ? search : trending
    const gifs = activeQuery.data?.gifs ?? []
    const isLoading = activeQuery.isLoading
    const errorMessage = activeQuery.error instanceof Error ? activeQuery.error.message : null

    const handleQueryChange = (event: ChangeEvent<HTMLInputElement>) => {
        setQuery(event.target.value)
        // Free-text search overrides the category chip.
        if (event.target.value.trim().length > 0) setSelectedCategory(null)
    }

    const handleSelect = async (gif: KlipyGif) => {
        if (isSending) return
        await onSelect(gif)
    }

    const placeholder = useMemo(() => t('chats.klipySearchPlaceholder'), [t])

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                className="flex max-h-[min(80vh,640px)] flex-col gap-3"
                onOpenAutoFocus={(event) => event.preventDefault()}
            >
                <DialogTitle className="text-base font-semibold">
                    {t('chats.klipyPickerTitle')}
                </DialogTitle>
                <DialogDescription className="sr-only">
                    {t('chats.klipyPickerDescription')}
                </DialogDescription>

                {availability.isFetching ? (
                    <div className="flex h-32 items-center justify-center text-sm text-[var(--app-hint)]">
                        {t('common.loading')}
                    </div>
                ) : !isConfigured ? (
                    <UnavailableState
                        onClose={() => onOpenChange(false)}
                        message={availability.error instanceof Error ? availability.error.message : null}
                    />
                ) : (
                    <>
                        <input
                            type="search"
                            inputMode="search"
                            autoComplete="off"
                            spellCheck={false}
                            placeholder={placeholder}
                            value={query}
                            onChange={handleQueryChange}
                            className="w-full rounded-lg border border-[var(--app-border)] bg-[var(--app-secondary-bg)] px-3 py-2 text-sm outline-none placeholder:text-[var(--app-hint)] focus:border-[var(--app-link)]"
                        />
                        {categories.data && categories.data.categories.length > 0 ? (
                            <div className="-mx-1 flex gap-2 overflow-x-auto px-1">
                                <CategoryChip
                                    active={selectedCategory === null}
                                    onClick={() => setSelectedCategory(null)}
                                    label={t('chats.klipyCategoryAll')}
                                />
                                {categories.data.categories.map((entry) => (
                                    <CategoryChip
                                        key={entry.category}
                                        active={selectedCategory === entry.query}
                                        onClick={() => setSelectedCategory(entry.query)}
                                        label={entry.category}
                                        previewUrl={entry.previewUrl}
                                    />
                                ))}
                            </div>
                        ) : null}
                        <div className="-mx-1 flex-1 overflow-y-auto px-1">
                            {isLoading ? (
                                <div className="flex h-32 items-center justify-center text-sm text-[var(--app-hint)]">
                                    {t('common.loading')}
                                </div>
                            ) : errorMessage ? (
                                <div className="flex h-32 flex-col items-center justify-center gap-1 text-center text-sm text-red-600">
                                    <span>{errorMessage}</span>
                                </div>
                            ) : gifs.length === 0 ? (
                                <div className="flex h-32 items-center justify-center text-sm text-[var(--app-hint)]">
                                    {searchTerm.length > 0
                                        ? t('chats.klipyNoResults')
                                        : t('chats.klipyTrendingEmpty')}
                                </div>
                            ) : (
                                <ul className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
                                    {gifs.map((gif) => (
                                        <li key={gif.id}>
                                            <button
                                                type="button"
                                                disabled={isSending}
                                                onClick={() => void handleSelect(gif)}
                                                className="group relative block aspect-square w-full overflow-hidden rounded-lg border border-[var(--app-border)] bg-[var(--app-subtle-bg)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)] disabled:opacity-50"
                                                title={gif.title || 'GIF'}
                                            >
                                                {gif.previewUrl ? (
                                                    <img
                                                        src={gif.previewUrl}
                                                        alt={gif.title || 'GIF'}
                                                        loading="lazy"
                                                        decoding="async"
                                                        referrerPolicy="no-referrer"
                                                        className="h-full w-full object-cover transition-transform group-hover:scale-105"
                                                    />
                                                ) : (
                                                    <div className="flex h-full w-full items-center justify-center text-xs text-[var(--app-hint)]">
                                                        GIF
                                                    </div>
                                                )}
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                        <footer className="flex items-center justify-between border-t border-[var(--app-border)] pt-2 text-xs text-[var(--app-hint)]">
                            <span>{t('chats.klipyAttribution')}</span>
                            {isSending ? <span>{t('chats.klipySending')}</span> : null}
                        </footer>
                    </>
                )}
            </DialogContent>
        </Dialog>
    )
}

function CategoryChip(props: { active: boolean; onClick: () => void; label: string; previewUrl?: string | null }) {
    return (
        <button
            type="button"
            onClick={props.onClick}
            className={`flex shrink-0 items-center gap-1 rounded-full px-3 py-1 text-xs transition-colors ${
                props.active
                    ? 'bg-[var(--app-button)] text-[var(--app-button-text)]'
                    : 'bg-[var(--app-secondary-bg)] text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)]'
            }`}
        >
            {props.previewUrl ? (
                <img src={props.previewUrl} alt="" aria-hidden="true" className="h-4 w-4 rounded object-cover" />
            ) : null}
            <span>{props.label}</span>
        </button>
    )
}

function UnavailableState(props: { onClose: () => void; message: string | null }) {
    const { t } = useTranslation()
    return (
        <div className="flex flex-col gap-3 py-6 text-center">
            <div className="text-sm font-medium text-[var(--app-fg)]">
                {t('chats.klipyUnavailableTitle')}
            </div>
            <p className="mx-auto max-w-sm text-sm text-[var(--app-hint)]">
                {props.message ?? t('chats.klipyUnavailableBody')}
            </p>
            <button
                type="button"
                onClick={props.onClose}
                className="mx-auto rounded-lg bg-[var(--app-button)] px-4 py-2 text-sm font-medium text-[var(--app-button-text)]"
            >
                {t('button.close')}
            </button>
        </div>
    )
}