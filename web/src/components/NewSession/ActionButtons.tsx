import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/Spinner'
import { useTranslation } from '@/lib/use-translation'

export function ActionButtons(props: {
    isPending: boolean
    canCreate: boolean
    isDisabled: boolean
    createLabel?: string
    onCancel: () => void
    onCreate: () => void
    onAddChat?: () => void
    managing?: boolean
    onManageProjects?: () => void
    manageProjectsOpen?: boolean
    onManageModels?: () => void
    manageModelsOpen?: boolean
}) {
    const { t } = useTranslation()

    return (
        <div className="flex w-full flex-wrap justify-end gap-2 px-3 pt-3 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
            {!props.managing && props.onAddChat ? <Button variant="outline" onClick={props.onAddChat} disabled={props.isDisabled} className="mr-auto gap-1.5 max-sm:w-full max-sm:justify-start max-sm:px-3">
                <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
                {t('batch.addAnother')}
            </Button> : null}
            {(!props.managing || props.manageModelsOpen) && props.onManageModels ? <Button variant="outline" onClick={props.onManageModels} aria-expanded={props.manageModelsOpen} className="max-sm:px-3">
                {t(props.manageModelsOpen ? 'newSession.models.hide' : 'newSession.models.manage')}
            </Button> : null}
            <div className="flex items-center justify-end gap-2">
            {(!props.managing || props.manageProjectsOpen) && props.onManageProjects ? <Button variant="outline" onClick={props.onManageProjects} aria-expanded={props.manageProjectsOpen} disabled={props.isDisabled} className="max-sm:px-3">
                {t(props.manageProjectsOpen ? 'newSession.projects.close' : 'newSession.projects.manage')}
            </Button> : null}
            {!props.managing ? <><Button
                variant="secondary"
                className="max-sm:px-3"
                onClick={props.onCancel}
                disabled={props.isDisabled}
            >
                {t('button.cancel')}
            </Button>
            <Button
                onClick={props.onCreate}
                disabled={!props.canCreate}
                aria-busy={props.isPending}
                className="gap-2 max-sm:px-3"
            >
                {props.isPending ? (
                    <>
                        <Spinner size="sm" label={null} className="text-[var(--app-button-text)]" />
                        {t('newSession.creating')}
                    </>
                ) : (
                    (props.createLabel ?? t('newSession.create'))
                )}
            </Button></> : null}
            </div>
        </div>
    )
}
