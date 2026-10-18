import { useTranslation } from '@/lib/use-translation'

export function ChoiceLabel({ kind }: { kind: 'agent' | 'model' | 'speed' }) {
    const { t } = useTranslation()
    return <span aria-hidden="true" className="hidden w-[68px] shrink-0 items-center justify-end gap-1.5 self-stretch border-r border-[var(--app-divider)] pr-3 text-xs font-medium text-[var(--app-hint)] sm:flex">
        <svg aria-hidden="true" className="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            {kind === 'agent' ? <>
                <rect x="4" y="7" width="16" height="13" rx="3" />
                <path d="M12 3v4M1 12v4m22-4v4M9 16h6" />
                <circle cx="8.5" cy="11.5" r=".5" /><circle cx="15.5" cy="11.5" r=".5" />
            </> : kind === 'model' ? <>
                <rect x="5" y="5" width="14" height="14" rx="2" /><rect x="9" y="9" width="6" height="6" rx="1" />
                <path d="M9 2v3m6-3v3M9 19v3m6-3v3M2 9h3m-3 6h3m14-6h3m-3 6h3" />
            </> : <>
                <path d="M4.9 19a9 9 0 1 1 14.2 0H4.9ZM12 5v1M6 13h1m10 0h1m-4.9-1.1L17 8" />
                <circle cx="12" cy="13" r="1.5" />
            </>}
        </svg>
        <span className="shrink-0">{t(kind === 'agent' ? 'newSession.agent' : kind === 'model' ? 'newSession.model' : 'newSession.speed')}</span>
    </span>
}
