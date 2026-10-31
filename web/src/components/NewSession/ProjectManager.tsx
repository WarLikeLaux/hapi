import { useState } from 'react'
import type { ProjectPreference } from '@/api/client'
import { useTranslation } from '@/lib/use-translation'
import { basename } from '@/utils/path'

export function ProjectManager(props: {
    machineId: string | null
    projects: ProjectPreference[]
    knownPaths: string[]
    save: (projects: ProjectPreference[]) => Promise<void>
}) {
    const { t } = useTranslation()
    const [path, setPath] = useState('')
    const [search, setSearch] = useState('')
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState(false)
    const configured = props.projects.filter(p => p.machineId === props.machineId)
    const projects: ProjectPreference[] = [...configured, ...props.knownPaths
        .filter(path => !configured.some(project => project.path === path))
        .map(path => ({ machineId: props.machineId!, path, alias: null, section: 'auto' as const, priority: false, isDefault: false }))]
    const control = 'rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] px-2 py-1.5 text-xs text-[var(--app-fg)] focus-visible:outline-2 focus-visible:outline-[var(--app-link)] disabled:opacity-40'
    async function update(next: ProjectPreference[]) {
        setBusy(true); setError(false)
        try { await props.save(next); return true } catch { setError(true); return false } finally { setBusy(false) }
    }
    function change(project: ProjectPreference, patch: Partial<ProjectPreference>) {
        const existing = props.projects.some(p => p.machineId === project.machineId && p.path === project.path)
        const next = props.projects.map(p => p.machineId === project.machineId && p.path === project.path
            ? { ...p, ...patch } : patch.isDefault ? { ...p, isDefault: false } : p)
        if (!existing) next.push({ ...project, ...patch })
        void update(next)
    }
    function move(project: ProjectPreference, direction: number) {
        const next = [...props.projects]
        const index = next.indexOf(project)
        const candidates = projects.filter(p => p.priority)
        const target = candidates[candidates.indexOf(project) + direction]
        if (!target) return
        const other = next.indexOf(target)
        ;[next[index], next[other]] = [next[other], next[index]]
        void update(next)
    }
    const validPath = path.trim().startsWith('/') || /^[a-zA-Z]:[\\/]/.test(path.trim()) || path.trim().startsWith('\\\\')
    const add = async () => {
        const value = path.trim()
        if (!validPath || !props.machineId || projects.some(p => p.path === value)) return
        if (await update([...props.projects, { machineId: props.machineId, path: value, alias: null, section: 'auto', priority: false, isDefault: false }])) setPath('')
    }
    const priorityProjects = configured.filter(p => p.priority)
    return <div className="mx-3 mb-3 rounded-xl border border-[var(--app-border)] bg-[var(--app-subtle-bg)] p-3 space-y-3">
        <p className="text-xs leading-relaxed text-[var(--app-hint)]">{t('newSession.projects.hint')}</p>
        <div className="flex gap-2">
            <input aria-label={t('newSession.projects.path')} placeholder={t('newSession.projects.path')} list="project-known-paths" value={path} onChange={e => setPath(e.target.value)} className={`${control} min-w-0 flex-1 text-sm`} />
            <datalist id="project-known-paths">{props.knownPaths.map(p => <option key={p} value={p} />)}</datalist>
            <button type="button" disabled={busy || !props.machineId || !validPath || projects.some(p => p.path === path.trim())} onClick={() => void add()} className={control}>{t('newSession.projects.add')}</button>
        </div>
        {path.trim() && !validPath ? <p role="status" className="text-xs text-[var(--app-hint)]">{t('newSession.projects.absolutePath')}</p> : null}
        {!projects.length ? <p className="py-2 text-xs text-[var(--app-hint)]">{t('newSession.projects.empty')}</p> : null}
        {projects.length > 3 ? <input aria-label={t('newSession.projects.search')} placeholder={t('newSession.projects.search')} value={search} onChange={event => setSearch(event.target.value)} className={`${control} w-full`} /> : null}
        <div className="max-h-96 overflow-y-auto divide-y divide-[var(--app-divider)]">
            {projects.filter(project => `${project.path} ${project.alias ?? ''}`.toLowerCase().includes(search.toLowerCase())).map(project => <div key={project.path} className={`space-y-2 py-3 first:pt-0 last:pb-0 ${project.hidden ? "opacity-60" : ""}`}>
                <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium text-[var(--app-fg)]">{project.alias || basename(project.path)}</div><div className="truncate text-xs text-[var(--app-hint)]" title={project.path}>{project.path}</div></div>
                    <button type="button" className={control} disabled={busy || project.hidden} aria-pressed={project.isDefault} onClick={() => change(project, { isDefault: !project.isDefault })}>{project.isDefault ? t('newSession.projects.defaultSet') : t('newSession.projects.setDefault')}</button>
                    <button type="button" className={control} disabled={busy} aria-pressed={Boolean(project.hidden)} onClick={() => change(project, { hidden: !project.hidden, isDefault: project.hidden ? project.isDefault : false })}>{project.hidden ? t('newSession.projects.show') : t('newSession.projects.hide')}</button>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <input key={`${project.path}:${project.alias}`} aria-label={t('newSession.projects.alias')} placeholder={t('newSession.projects.alias')} defaultValue={project.alias ?? ''} maxLength={80} onBlur={e => { const alias = e.target.value.trim() || null; if (alias !== project.alias) change(project, { alias }) }} className={`${control} min-w-24 flex-1`} />
                    <select aria-label={t('newSession.projects.section')} value={project.section} disabled={busy} onChange={e => change(project, { section: e.target.value as ProjectPreference['section'] })} className={control}>
                        <option value="auto">{t('newSession.projects.auto')}</option><option value="work">{t('newSession.working')}</option><option value="recent">{t('newSession.recent')}</option>
                    </select>
                    <button type="button" className={control} disabled={busy} aria-pressed={project.priority} onClick={() => change(project, { priority: !project.priority })}>{t('newSession.projects.priority')}{project.priority ? ' ✓' : ''}</button>
                    {project.priority ? <><button type="button" className={control} disabled={busy || priorityProjects.indexOf(project) === 0} aria-label={t('newSession.projects.up')} onClick={() => move(project, -1)}>↑</button><button type="button" className={control} disabled={busy || priorityProjects.indexOf(project) === priorityProjects.length - 1} aria-label={t('newSession.projects.down')} onClick={() => move(project, 1)}>↓</button></> : null}
                </div>
            </div>)}
        </div>
        {error ? <p role="alert" className="text-xs text-red-600">{t('newSession.projects.error')}</p> : null}
    </div>
}
