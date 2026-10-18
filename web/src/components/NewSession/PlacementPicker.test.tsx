import { useState } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { PlacementPicker } from './PlacementPicker'

vi.mock('@/lib/use-translation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

it('selects group placement by keyboard, preserves the group ID and returns focus after selection or Escape', async () => {
    Element.prototype.scrollIntoView = vi.fn()
    const onChange = vi.fn()
    function Form() {
        const [value, setValue] = useState('new')
        return <PlacementPicker value={value} groups={[{ id: 'group-research', name: 'Research' }]} disabled={false}
            onChange={next => { setValue(next); onChange(next) }} />
    }
    render(<Form />)
    const trigger = screen.getByRole('button', { name: /^batch.placement/ })
    trigger.focus()
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    const menu = await screen.findByRole('menu')
    const current = screen.getByRole('menuitemradio', { name: 'batch.newGroup' })
    expect(current).toHaveAttribute('aria-checked', 'true')
    await waitFor(() => expect(current).toHaveFocus())
    fireEvent.keyDown(menu, { key: 'End' })
    const research = screen.getByRole('menuitemradio', { name: 'Research' })
    expect(research).toHaveFocus()
    fireEvent.click(research)
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    expect(onChange).toHaveBeenCalledWith('group-research')
    expect(trigger).toHaveTextContent('Research')
    await waitFor(() => expect(trigger).toHaveFocus())
    fireEvent.keyDown(trigger, { key: 'ArrowUp' })
    await screen.findByRole('menu')
    await waitFor(() => expect(screen.getByRole('menuitemradio', { name: 'Research' })).toHaveFocus())
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Home' })
    expect(screen.getByRole('menuitemradio', { name: 'batch.noGroup' })).toHaveFocus()
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    await waitFor(() => expect(trigger).toHaveFocus())
    expect(onChange).toHaveBeenCalledOnce()
})
