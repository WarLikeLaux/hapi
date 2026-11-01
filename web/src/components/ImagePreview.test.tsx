import type { ReactElement } from 'react'
import { fireEvent, render as renderComponent, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ImagePreview, ImagePreviewProvider } from './ImagePreview'
import { MessageAttachments } from './AssistantChat/messages/MessageAttachments'

function render(ui: ReactElement) {
    return renderComponent(ui, { wrapper: ImagePreviewProvider })
}

function renderGallery() {
    render(
        <>
            <ImagePreview src="/first.png" fileName="first.png" label="First image" fileSize={1536} galleryId="example-message" />
            <ImagePreview src="/second.png" fileName="second.png" label="Second image" fileSize={2048} galleryId="example-message" />
        </>
    )
}

describe('ImagePreview gallery navigation', () => {
    it.each(['mouse', 'touch', 'pen'])('keeps %s preview gestures out of the surrounding attachment drag handler', (pointerType) => {
        const onAttachmentPointerDown = vi.fn()
        render(
            <div onPointerDown={onAttachmentPointerDown}>
                <ImagePreview src="/photo.png" fileName="photo.png" label="Photo" />
            </div>
        )
        fireEvent.click(screen.getByTitle('Click to zoom'))
        const dialog = screen.getByRole('dialog')
        const image = within(dialog).getByRole('img', { name: 'Photo' })
        const canvas = image.parentElement!
        const setPointerCapture = vi.fn()
        Object.defineProperty(canvas, 'setPointerCapture', { value: setPointerCapture, configurable: true })
        const pointer = (type: string, x: number, y: number, buttons: number) => {
            const event = new Event(type, { bubbles: true, cancelable: true })
            Object.defineProperties(event, {
                pointerId: { value: 1 }, pointerType: { value: pointerType },
                button: { value: 0 }, buttons: { value: buttons },
                clientX: { value: x }, clientY: { value: y },
            })
            fireEvent(image, event)
        }

        pointer('pointerdown', 100, 100, 1)
        expect(setPointerCapture).toHaveBeenCalledWith(1)
        expect(onAttachmentPointerDown).not.toHaveBeenCalled()
        pointer('pointermove', 140, 120, 1)
        expect(image.style.transform).toContain('40px')
        pointer('pointerup', 140, 120, 0)
        const releasedTransform = image.style.transform
        pointer('pointermove', 180, 160, 0)
        expect(image.style.transform).toBe(releasedTransform)

        pointer('pointerdown', 180, 160, 1)
        pointer('pointermove', 200, 180, 1)
        pointer('pointercancel', 200, 180, 0)
        const cancelledTransform = image.style.transform
        pointer('pointermove', 240, 220, 0)
        expect(image.style.transform).toBe(cancelledTransform)

        fireEvent.pointerDown(within(dialog).getByTitle('Zoom in'))
        expect(onAttachmentPointerDown).not.toHaveBeenCalled()
        fireEvent.click(within(dialog).getByTitle('Zoom in'))
        expect(within(dialog).getByTitle('Reset zoom')).toHaveTextContent('125%')
    })

    it('navigates between rendered image previews with toolbar buttons', () => {
        renderGallery()

        fireEvent.click(screen.getByRole('button', { name: /first image/i }))

        const dialog = screen.getByRole('dialog', { name: 'First image' })
        expect(within(dialog).getAllByRole('button').map((button) => button.getAttribute('title'))).toEqual([
            'Close',
            'Zoom out',
            'Reset zoom',
            'Zoom in',
            'Previous image',
            'Next image',
        ])
        expect(within(dialog).getAllByRole('button')
            .map((button) => button.querySelector('svg')?.getAttribute('class'))
            .filter(Boolean)).toEqual([
            'h-4 w-4',
            'h-4 w-4',
            'h-4 w-4',
            'h-4 w-4',
            'h-4 w-4',
        ])
        expect(within(dialog).getByRole('button', { name: '100%' })).toHaveClass(
            'flex',
            'h-8',
            'items-center',
            'justify-center',
        )
        const image = within(dialog).getByRole('img', { name: 'First image' })
        Object.defineProperty(image, 'naturalWidth', { configurable: true, value: 1200 })
        Object.defineProperty(image, 'naturalHeight', { configurable: true, value: 700 })
        fireEvent.load(image)
        expect(image).toHaveClass('max-h-full', 'max-w-full')
        const desktopInfo = dialog.querySelector('[data-image-preview-info="desktop"]')
        expect(desktopInfo).not.toBeNull()
        expect(desktopInfo).toHaveClass('flex', 'flex-1', 'items-center', 'max-sm:hidden')
        expect(desktopInfo).toHaveTextContent('first.png')
        const mobileInfo = dialog.querySelector('[data-image-preview-info="mobile"]')
        expect(mobileInfo).not.toBeNull()
        expect(mobileInfo).toHaveClass('hidden', 'max-sm:flex', 'border-t')
        const imageMetadata = within(desktopInfo as HTMLElement).getByText('1200 × 700 px · 1.5 KB')
        expect(imageMetadata).toBeInTheDocument()
        expect(imageMetadata).toHaveClass('shrink-0', 'text-sm', 'text-white/60')
        expect(imageMetadata.parentElement).toHaveClass('items-center', 'text-sm')
        expect(imageMetadata.parentElement).toHaveAttribute('data-image-preview-info', 'desktop')
        expect(dialog).toHaveClass('fixed', 'inset-0', 'flex-col')
        expect(within(dialog).getByRole('button', { name: 'Zoom out' }).parentElement).toHaveAttribute('data-image-preview-controls', '')
        expect(within(dialog).getByRole('button', { name: 'Zoom out' }).parentElement).toHaveClass('max-sm:order-2', 'max-sm:gap-1')
        expect(within(dialog).getByText('1 / 2')).toBeInTheDocument()
        expect(within(dialog).getByRole('button', { name: 'Previous image' })).toBeDisabled()

        fireEvent.click(within(dialog).getByRole('button', { name: 'Next image' }))

        const nextDialog = screen.getByRole('dialog', { name: 'Second image' })
        const nextDesktopInfo = nextDialog.querySelector('[data-image-preview-info="desktop"]')
        expect(nextDesktopInfo).not.toBeNull()
        expect(nextDesktopInfo).toHaveTextContent('second.png')
        expect(nextDesktopInfo).toHaveTextContent('2 KB')
        expect(within(nextDialog).getByText('2 / 2')).toBeInTheDocument()
        expect(within(nextDialog).getByRole('img', { name: 'Second image' })).toHaveAttribute('src', '/second.png')
        expect(within(nextDialog).getByRole('button', { name: 'Next image' })).toBeDisabled()
    })

    it('supports left and right arrow keys', () => {
        renderGallery()

        fireEvent.click(screen.getByRole('button', { name: /first image/i }))
        fireEvent.keyDown(window, { key: 'ArrowRight' })
        expect(screen.getByRole('dialog', { name: 'Second image' })).toBeInTheDocument()

        fireEvent.keyDown(window, { key: 'ArrowLeft' })
        expect(screen.getByRole('dialog', { name: 'First image' })).toBeInTheDocument()
    })

    it('keeps named galleries separate from ungrouped previews', () => {
        render(
            <>
                <ImagePreview src="/sent.png" label="Sent image" />
                <ImagePreview src="/draft-one.png" label="First draft" galleryId="composer-attachments" />
                <ImagePreview src="/draft-two.png" label="Second draft" galleryId="composer-attachments" />
            </>
        )

        fireEvent.click(screen.getByRole('button', { name: /first draft/i }))

        const dialog = screen.getByRole('dialog', { name: 'First draft' })
        expect(within(dialog).getByText('1 / 2')).toBeInTheDocument()
        fireEvent.click(within(dialog).getByRole('button', { name: 'Next image' }))
        expect(screen.getByRole('dialog', { name: 'Second draft' })).toBeInTheDocument()
        expect(within(screen.getByRole('dialog')).queryByRole('img', { name: 'Sent image' })).not.toBeInTheDocument()
    })

    it('keeps standalone previews separate unless a gallery is explicitly supplied', () => {
        render(<>
            <ImagePreview src="/one.png" label="Standalone one" />
            <ImagePreview src="/two.png" label="Standalone two" />
        </>)
        fireEvent.click(screen.getByRole('button', { name: /standalone two/i }))
        fireEvent.keyDown(window, { key: 'ArrowLeft' })
        const dialog = screen.getByRole('dialog', { name: 'Standalone two' })
        expect(within(dialog).queryByRole('button', { name: 'Previous image' })).not.toBeInTheDocument()
        expect(within(dialog).queryByRole('button', { name: 'Next image' })).not.toBeInTheDocument()
    })

    it('opens the clicked message attachment and retains only its ordered images across chat updates', () => {
        const attachments = (names: string[]) => names.map(name => ({
            id: name, filename: `${name}.png`, mimeType: 'image/png', size: 100,
            path: `/uploads/${name}.png`, previewUrl: `/${name}.png`
        }))
        const source = <MessageAttachments attachments={attachments(['first', 'second'])} />
        const single = <MessageAttachments attachments={attachments(['single'])} />
        const { rerender } = render(<>{source}{single}</>)
        fireEvent.click(screen.getByRole('button', { name: 'second.png' }))
        expect(within(screen.getByRole('dialog')).getByText('2 / 2')).toBeInTheDocument()
        expect(within(screen.getByRole('dialog')).getByRole('img')).toHaveAttribute('src', '/second.png')
        expect(screen.getByRole('button', { name: 'Next image' })).toBeDisabled()

        rerender(<>
            <MessageAttachments attachments={attachments(['older-one', 'older-two', 'older-three'])} />
            {source}{single}
            <MessageAttachments attachments={attachments(['new-one', 'new-two'])} />
        </>)
        fireEvent.keyDown(window, { key: 'ArrowRight' })
        expect(within(screen.getByRole('dialog')).getByText('2 / 2')).toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: 'Previous image' }))
        expect(within(screen.getByRole('dialog')).getByRole('img')).toHaveAttribute('src', '/first.png')
        expect(within(screen.getByRole('dialog')).getByText('1 / 2')).toBeInTheDocument()
        fireEvent.keyDown(window, { key: 'ArrowLeft' })
        expect(screen.getByRole('button', { name: 'Previous image' })).toBeDisabled()
        fireEvent.keyDown(window, { key: 'ArrowRight' })
        expect(within(screen.getByRole('dialog')).getByRole('img')).toHaveAttribute('src', '/second.png')

        fireEvent.click(screen.getByTitle('Close'))
        fireEvent.click(screen.getByRole('button', { name: 'single.png' }))
        fireEvent.keyDown(window, { key: 'ArrowLeft' })
        fireEvent.keyDown(window, { key: 'ArrowRight' })
        expect(within(screen.getByRole('dialog')).getByRole('img')).toHaveAttribute('src', '/single.png')
        expect(screen.queryByRole('button', { name: 'Next image' })).not.toBeInTheDocument()
        expect(screen.queryByRole('button', { name: 'Previous image' })).not.toBeInTheDocument()
    })

    it('exposes trigger pointer and context-menu hooks for sortable image attachments', () => {
        const onTriggerPointerDown = vi.fn()
        const onTriggerContextMenu = vi.fn()
        const onTriggerClick = vi.fn()

        render(
            <ImagePreview
                src="/drag.png"
                label="Drag image"
                onTriggerPointerDown={onTriggerPointerDown}
                onTriggerContextMenu={onTriggerContextMenu}
                onTriggerClick={onTriggerClick}
            />
        )

        const trigger = screen.getByRole('button', { name: /drag image/i })
        fireEvent.pointerDown(trigger)
        fireEvent.contextMenu(trigger)
        fireEvent.click(trigger)

        expect(onTriggerPointerDown).toHaveBeenCalledTimes(1)
        expect(onTriggerContextMenu).toHaveBeenCalledTimes(1)
        expect(onTriggerClick).toHaveBeenCalledTimes(1)
        expect(screen.getByRole('dialog', { name: 'Drag image' })).toBeInTheDocument()
    })
})


describe('ImagePreview viewer lifetime', () => {
    it('keeps the current image and zoom when its message or attachment is replaced', () => {
        const source = <ImagePreview src="/first.png" label="First image" />
        const { rerender } = render(source)
        fireEvent.click(screen.getByTitle('Click to zoom'))
        fireEvent.click(screen.getByTitle('Zoom in'))

        rerender(<div>Updated conversation</div>)
        const dialog = screen.getByRole('dialog', { name: 'First image' })
        expect(within(dialog).getByRole('img')).toHaveAttribute('src', '/first.png')
        expect(within(dialog).getByTitle('Reset zoom')).toHaveTextContent('125%')
        fireEvent.click(within(dialog).getByTitle('Zoom in'))
        expect(within(dialog).getByTitle('Reset zoom')).toHaveTextContent('150%')

        fireEvent.click(within(dialog).getByTitle('Close'))
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
        rerender(source)
        fireEvent.click(screen.getByTitle('Click to zoom'))
        expect(screen.getByTitle('Reset zoom')).toHaveTextContent('100%')
        fireEvent.keyDown(window, { key: 'Escape' })
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
})
