import illustration from '@/assets/illustrations/gojo-unavailable.webp'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/Spinner'
import { useTranslation } from '@/lib/use-translation'

export function UnavailableScreen({ onRetry }: { onRetry: () => void }) {
    const { t } = useTranslation()
    return (
        <main className="app-scroll-y flex h-full items-center justify-center p-5">
            <div className="w-full max-w-md text-center" role="status">
                <img src={illustration} alt="" className="aspect-[16/9] w-full rounded-xl object-cover" />
                <h1 className="mt-6 text-2xl font-semibold text-[var(--app-fg)]">{t('unavailable.title')}</h1>
                <p className="mt-2 text-sm leading-6 text-[var(--app-hint)]">{t('unavailable.description')}</p>
                <div className="mt-5 flex items-center justify-center gap-3">
                    <Spinner size="sm" label={null} />
                    <Button variant="secondary" onClick={onRetry}>{t('unavailable.retry')}</Button>
                </div>
            </div>
        </main>
    )
}
