import { useTranslation } from '@/lib/use-translation'

export function MuteControl(props: { muted: boolean; disabled: boolean; onChange: (value: boolean) => void }) {
    const { t } = useTranslation()
    return <label title={t('newSession.mutedHint')} className="group inline-flex cursor-pointer items-center">
        <input type="checkbox" checked={props.muted} disabled={props.disabled} onChange={event => props.onChange(event.target.checked)} className="peer sr-only" />
        <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--app-border)] bg-[var(--app-subtle-bg)] px-2.5 py-1 text-xs font-medium text-[var(--app-hint)] transition-colors group-hover:text-[var(--app-fg)] peer-checked:border-[var(--app-link)] peer-checked:bg-[var(--app-link)] peer-checked:text-[var(--app-bg)] peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--app-link)] peer-focus-visible:ring-offset-2 peer-disabled:opacity-50">
            <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M10.6 3.2A7 7 0 0 1 19 10v4l2 3H7M5 5l14 14M3 3l18 18M9.8 21a2.5 2.5 0 0 0 4.4 0M5 9.2V14l-2 3h2" /></svg>
            {t('newSession.muted')}
        </span>
    </label>
}
