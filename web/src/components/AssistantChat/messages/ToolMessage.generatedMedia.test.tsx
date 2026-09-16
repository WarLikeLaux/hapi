import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { HappyChatProvider } from '@/components/AssistantChat/context'
import {
    createSandboxedHtmlPreviewBlob,
    GeneratedImageCard,
    isMarkdownFileName,
} from '@/components/AssistantChat/messages/ToolMessage'
import { I18nProvider } from '@/lib/i18n-context'
import type { ApiClient } from '@/api/client'
import type { HappyChatContextValue } from '@/components/AssistantChat/context'

function renderCard(options: {
    mimeType: string | null
    fileName?: string
    locale?: 'en' | 'zh-CN'
    getGeneratedImageBlob?: ReturnType<typeof vi.fn>
}) {
    if (options.locale) {
        localStorage.setItem('hapi-lang', options.locale)
    } else {
        localStorage.removeItem('hapi-lang')
    }

    const getGeneratedImageBlob = options.getGeneratedImageBlob ?? vi.fn(async () => new Blob(['x'], { type: options.mimeType ?? 'image/png' }))
    const api = { getGeneratedImageBlob } as unknown as ApiClient
    const value: HappyChatContextValue = {
        api,
        sessionId: 'session-1',
        metadata: null,
        terminalToolDisplayMode: 'compact',
        showSessionSummaryInChat: false,
        disabled: false,
        onRefresh: () => {},
        hasMoreMessages: false,
        isSyncingTail: false,
        isLoadingMoreMessages: false,
        loadOlderMessagesPreservingScroll: async () => 'loaded',
    }

    render(
        <I18nProvider>
            <HappyChatProvider value={value}>
                <GeneratedImageCard
                    block={{
                        kind: 'generated-image',
                        id: 'block-1',
                        localId: null,
                        createdAt: 1,
                        imageId: 'img-1',
                        fileName: options.fileName ?? 'clip.mp4',
                        mimeType: options.mimeType,
                    }}
                />
            </HappyChatProvider>
        </I18nProvider>
    )

    return { getGeneratedImageBlob }
}

describe('GeneratedImageCard video fetch', () => {
    it('recognizes common Markdown file extensions', () => {
        expect(isMarkdownFileName('notes.md')).toBe(true)
        expect(isMarkdownFileName('GUIDE.MARKDOWN')).toBe(true)
        expect(isMarkdownFileName('archive.md.txt')).toBe(false)
    })

    it('labels displayed images in English without implying AI generation', () => {
        renderCard({ mimeType: 'image/png', locale: 'en' })

        expect(screen.getByText('Displayed image: clip.mp4')).toBeInTheDocument()
        expect(screen.queryByText(/Generated image/)).not.toBeInTheDocument()
    })

    it('localizes the displayed image label in Chinese', () => {
        renderCard({ mimeType: 'image/png', locale: 'zh-CN' })

        expect(screen.getByText('展示图片：clip.mp4')).toBeInTheDocument()
        expect(screen.queryByText(/Generated image/)).not.toBeInTheDocument()
    })

    it('does not call the API for an untouched video card', async () => {
        const { getGeneratedImageBlob } = renderCard({ mimeType: 'video/mp4' })

        expect(screen.getByRole('button', { name: 'Load video' })).toBeInTheDocument()
        await new Promise((resolve) => setTimeout(resolve, 20))
        expect(getGeneratedImageBlob).not.toHaveBeenCalled()
    })

    it('fetches the blob after the user clicks Load video', async () => {
        const { getGeneratedImageBlob } = renderCard({ mimeType: 'video/mp4' })

        fireEvent.click(screen.getByRole('button', { name: 'Load video' }))

        await waitFor(() => {
            expect(getGeneratedImageBlob).toHaveBeenCalledWith('session-1', 'img-1')
        })
    })

    it('still fetches images on mount', async () => {
        const { getGeneratedImageBlob } = renderCard({ mimeType: 'image/png' })

        await waitFor(() => {
            expect(getGeneratedImageBlob).toHaveBeenCalledWith('session-1', 'img-1')
        })
    })

    it('loads audio on demand and renders controls', async () => {
        renderCard({ mimeType: 'audio/wav' })

        fireEvent.click(screen.getByRole('button', { name: 'Load audio' }))

        await waitFor(() => {
            expect(document.querySelector('audio[controls]')).toBeInTheDocument()
        })
    })

    it('loads unknown files on demand and renders a download link', async () => {
        renderCard({ mimeType: 'application/octet-stream' })

        fireEvent.click(screen.getByRole('button', { name: 'Prepare download' }))

        await waitFor(() => {
            expect(screen.getByRole('link', { name: /Download clip\.mp4/ })).toHaveAttribute('download', 'clip.mp4')
        })
    })

    it('opens Markdown in a preview dialog with a separate download action', async () => {
        const { getGeneratedImageBlob } = renderCard({
            mimeType: 'text/markdown',
            fileName: 'notes.md',
            getGeneratedImageBlob: vi.fn(async () => new Blob(['# Preview heading'], { type: 'text/markdown' })),
        })

        expect(getGeneratedImageBlob).not.toHaveBeenCalled()
        fireEvent.click(screen.getByRole('button', { name: 'Preview notes.md' }))

        expect(await screen.findByRole('heading', { name: 'Preview heading' })).toBeInTheDocument()
        expect(screen.getByRole('dialog')).toBeInTheDocument()
        expect(screen.getByRole('link', { name: 'Download' })).toHaveAttribute('download', 'notes.md')
        expect(screen.queryByRole('link', { name: /Download notes\.md/ })).not.toBeInTheDocument()
    })

    it('fetches HTML on mount and renders a one-tap browser link', async () => {
        const { getGeneratedImageBlob } = renderCard({
            mimeType: 'application/octet-stream',
            fileName: 'diagram.html',
            getGeneratedImageBlob: vi.fn(async () => new Blob(['<h1>Diagram</h1>'])),
        })

        await waitFor(() => {
            expect(getGeneratedImageBlob).toHaveBeenCalledWith('session-1', 'img-1')
        })
        const link = await screen.findByRole('link', { name: 'Open diagram.html' })
        expect(link).toHaveAttribute('target', '_blank')
        expect(link).not.toHaveAttribute('download')
        expect(screen.queryByRole('button', { name: 'Prepare download' })).not.toBeInTheDocument()
    })

    it('isolates interactive HTML from the HAPI origin', async () => {
        const preview = await createSandboxedHtmlPreviewBlob(
            new Blob(['<script>document.body.textContent = localStorage.token</script>']),
            'unsafe.html'
        )
        const wrapper = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
            reader.onerror = () => reject(reader.error)
            reader.readAsText(preview)
        })

        expect(preview.type).toBe('text/html')
        expect(wrapper).toContain('sandbox="allow-scripts allow-forms allow-modals allow-downloads"')
        expect(wrapper).not.toContain('allow-same-origin')
        expect(wrapper).toContain('&lt;script&gt;')
    })
})
