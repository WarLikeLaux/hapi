import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { ProjectPreference } from '@/api/client'
import { ProjectManager } from './ProjectManager'

vi.mock('@/lib/use-translation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

describe('project management', () => {
    it('adds a project without history and lets it become the default', async () => {
        const save = vi.fn()
        function App() {
            const [projects, setProjects] = useState<ProjectPreference[]>([])
            return <ProjectManager machineId="m1" projects={projects} knownPaths={[]} save={async next => { save(next); setProjects(next) }} />
        }
        render(<App />)
        fireEvent.change(screen.getByLabelText('newSession.projects.path'), { target: { value: 'relative' } })
        expect(screen.getByRole('button', { name: 'newSession.projects.add' })).toBeDisabled()
        fireEvent.change(screen.getByLabelText('newSession.projects.path'), { target: { value: '/code/hapi' } })
        fireEvent.click(screen.getByRole('button', { name: 'newSession.projects.add' }))
        await screen.findByText('/code/hapi')
        await waitFor(() => expect(screen.getByRole('button', { name: 'newSession.projects.setDefault' })).toBeEnabled())
        fireEvent.click(screen.getByRole('button', { name: 'newSession.projects.setDefault' }))
        await waitFor(() => expect(save).toHaveBeenLastCalledWith([expect.objectContaining({ path: '/code/hapi', isDefault: true })]))
    })

    it('hides and restores an existing project without deleting its session history', async () => {
        const save = vi.fn()
        function App() {
            const [projects, setProjects] = useState<ProjectPreference[]>([])
            return <ProjectManager machineId="m1" projects={projects} knownPaths={['/code/existing']} save={async next => { save(next); setProjects(next) }} />
        }
        render(<App />)
        fireEvent.click(screen.getByRole('button', { name: 'newSession.projects.hide' }))
        await waitFor(() => expect(save).toHaveBeenLastCalledWith([expect.objectContaining({ path: '/code/existing', hidden: true })]))
        fireEvent.click(await screen.findByRole('button', { name: 'newSession.projects.show' }))
        await waitFor(() => expect(save).toHaveBeenLastCalledWith([expect.objectContaining({ path: '/code/existing', hidden: false })]))
    })

})
