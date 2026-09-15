import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nProvider } from '@/lib/i18n-context'
import { formatFileMetadata } from '@/lib/file-metadata'
import { encodeBase64 } from '@/lib/utils'
import { scrollFileLineToCenter } from '@/lib/fileLineScroll'
import FilePage from './file'

const goBackMock = vi.fn()
const copyMock = vi.hoisted(() => vi.fn())
const scrollIntoViewMock = vi.hoisted(() => vi.fn())
const getGitDiffFileMock = vi.hoisted(() => vi.fn(async () => ({ success: true, stdout: '' })))
const routeSearchMock = vi.hoisted(() => ({
    comparison: undefined as undefined | 'last-commit' | 'branch',
    line: undefined as number | undefined,
    column: undefined as number | undefined,
}))

const sampleMarkdown = '# Heading\n\n| Col A | Col B |\n| --- | --- |\n| one | two |'
const filePath = 'docs/README.md'
const encodedPath = encodeBase64(filePath)
const encodedContent = encodeBase64(sampleMarkdown)
const fileSize = 1024
const fileModified = 1_784_175_060_000

vi.mock('@tanstack/react-router', () => ({
    useParams: () => ({ sessionId: 'session-1' }),
    useSearch: () => ({
        path: encodedPath,
        staged: undefined,
        comparison: routeSearchMock.comparison,
        line: routeSearchMock.line,
        column: routeSearchMock.column,
    }),
}))

vi.mock('@/lib/app-context', () => ({
    useAppContext: () => ({
        api: {
            getGitDiffFile: getGitDiffFileMock,
            readSessionFile: vi.fn(async () => ({
                success: true,
                content: encodedContent,
                size: fileSize,
                modified: fileModified,
            })),
        },
    }),
}))

vi.mock('@/hooks/useAppGoBack', () => ({
    useAppGoBack: () => goBackMock,
}))

vi.mock('@/hooks/useCopyToClipboard', () => ({
    useCopyToClipboard: () => ({
        copied: false,
        copy: copyMock,
    }),
}))

vi.mock('@/lib/shiki', () => ({
    langAlias: { md: 'markdown' },
    splitCodeLines: (content: string) => content.split('\n'),
    useShikiHighlightedLines: () => null,
}))

vi.mock('@/components/MarkdownRenderer', () => ({
    MarkdownRenderer: (props: { content: string }) => (
        <div data-testid="markdown-preview">{props.content}</div>
    ),
}))

function renderWithProviders() {
    const queryClient = new QueryClient({
        defaultOptions: {
            queries: { retry: false },
        },
    })
    return render(
        <QueryClientProvider client={queryClient}>
            <I18nProvider>
                <FilePage />
            </I18nProvider>
        </QueryClientProvider>
    )
}

describe('FilePage markdown preview', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        routeSearchMock.comparison = undefined
        routeSearchMock.line = undefined
        routeSearchMock.column = undefined
        Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
            configurable: true,
            value: scrollIntoViewMock,
        })
        scrollIntoViewMock.mockReset()
        window.localStorage.clear()
        window.sessionStorage.clear()
    })

    it('loads a committed file diff with the selected comparison scope', async () => {
        routeSearchMock.comparison = 'branch'
        renderWithProviders()

        await waitFor(() => {
            expect(getGitDiffFileMock).toHaveBeenCalledWith(
                'session-1',
                filePath,
                undefined,
                'branch'
            )
        })
    })

    it('renders markdown preview by default and toggles to source', async () => {
        renderWithProviders()

        await waitFor(() => {
            expect(screen.getByTestId('markdown-preview')).toHaveTextContent('# Heading')
        })
        expect(screen.getByText(formatFileMetadata(fileSize, fileModified, 'en')!)).toBeInTheDocument()
        expect(screen.getAllByText(filePath)).toHaveLength(1)
        const previewCopyButton = screen.getByRole('button', { name: 'Copy file content' })
        expect(previewCopyButton.closest('[data-hapi-file-content-header="true"]')).not.toBeNull()
        expect(previewCopyButton).not.toHaveClass('absolute')
        fireEvent.click(previewCopyButton)
        expect(copyMock).toHaveBeenCalledWith(sampleMarkdown)
        expect(screen.getByRole('button', { name: 'Preview' })).toHaveClass(
            'bg-[var(--app-secondary-bg)]',
            'text-[var(--app-fg)]'
        )

        fireEvent.click(screen.getByRole('button', { name: 'Source' }))

        await waitFor(() => {
            expect(screen.getByRole('code')).toHaveTextContent('# Heading')
        })
        const sourcePreview = screen.getByRole('code').closest('[data-hapi-file-source-preview="true"]')
        const sourceCopyButton = screen.getByRole('button', { name: 'Copy file content' })
        expect(sourcePreview).not.toBeNull()
        expect(sourcePreview).toContainElement(sourceCopyButton)
        expect(sourceCopyButton.closest('[data-hapi-file-content-header="true"]')).not.toBeNull()
        expect(sourceCopyButton).not.toHaveClass('absolute')
        expect(screen.queryByTestId('markdown-preview')).not.toBeInTheDocument()

        fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
        await waitFor(() => {
            expect(screen.getByTestId('markdown-preview')).toBeInTheDocument()
        })
    })

    it('uses the shared code-wrap preference for the source preview', async () => {
        window.localStorage.setItem('hapi-code-wrap', '1')
        renderWithProviders()

        await waitFor(() => {
            expect(screen.getByTestId('markdown-preview')).toBeInTheDocument()
        })
        fireEvent.click(screen.getByRole('button', { name: 'Source' }))

        await waitFor(() => {
            expect(screen.getByRole('code')).toHaveTextContent('# Heading')
        })
        const sourceCode = screen.getByRole('code')
        const sourcePre = sourceCode.closest('pre')
        const wrapToggle = screen.getByRole('button', { pressed: true })

        expect(wrapToggle).toBeInTheDocument()
        expect(sourcePre).toHaveStyle({ whiteSpace: 'pre-wrap', wordBreak: 'break-word' })

        fireEvent.click(wrapToggle)

        expect(screen.getByRole('button', { pressed: false })).toBeInTheDocument()
        expect(sourcePre).toHaveStyle({ whiteSpace: 'pre' })
        expect(window.localStorage.getItem('hapi-code-wrap')).toBeNull()
    })

    it('preserves the file preview scroll position across route remounts', async () => {
        const firstRender = renderWithProviders()

        await waitFor(() => {
            expect(screen.getByTestId('markdown-preview')).toBeInTheDocument()
        })
        const firstScrollRegion = document.querySelector('[data-hapi-file-scroll="true"]') as HTMLElement
        expect(firstScrollRegion).not.toBeNull()
        firstScrollRegion.scrollTop = 123
        firstRender.unmount()

        renderWithProviders()
        await waitFor(() => {
            expect(screen.getByTestId('markdown-preview')).toBeInTheDocument()
        })
        const secondScrollRegion = document.querySelector('[data-hapi-file-scroll="true"]') as HTMLElement
        expect(secondScrollRegion.scrollTop).toBe(123)
    })

    it('opens source, highlights the requested line, and ignores saved scroll', async () => {
        routeSearchMock.line = 3
        routeSearchMock.column = 2
        let resolveDiff: ((value: { success: true; stdout: string }) => void) | undefined
        getGitDiffFileMock.mockImplementationOnce(() => new Promise((resolve) => {
            resolveDiff = resolve
        }))
        window.sessionStorage.setItem(
            `hapi-file-scroll-session-1:${encodeURIComponent(filePath)}:unstaged`,
            '123'
        )
        renderWithProviders()

        await waitFor(() => {
            expect(getGitDiffFileMock).toHaveBeenCalled()
        })
        expect(document.querySelector('[data-hapi-target-line="true"]')).toBeNull()
        await act(async () => {
            resolveDiff?.({ success: true, stdout: '' })
        })

        await waitFor(() => {
            expect(document.querySelector('[data-hapi-target-line="true"]')).not.toBeNull()
        })
        expect(screen.queryByTestId('markdown-preview')).not.toBeInTheDocument()
        const target = document.querySelector('[data-hapi-target-line="true"]')
        expect(target).toHaveAttribute('aria-current', 'location')
        const scrollRegion = document.querySelector('[data-hapi-file-scroll="true"]') as HTMLElement
        expect(scrollRegion.scrollTop).not.toBe(123)
        await waitFor(() => expect(scrollIntoViewMock).toHaveBeenCalledWith({
            block: 'center',
            inline: 'nearest',
        }))
    })

    it('uses the final source line when a stale link points past end of file', async () => {
        routeSearchMock.line = 150
        renderWithProviders()

        await waitFor(() => {
            expect(document.querySelector('[data-hapi-target-line="true"]')).not.toBeNull()
        })

        const target = document.querySelector('[data-hapi-target-line="true"]')
        expect(target?.previousElementSibling).toHaveTextContent('5')
        await waitFor(() => expect(scrollIntoViewMock).toHaveBeenCalled())
    })
})

describe('scrollFileLineToCenter', () => {
    it('centers the target in the file viewport after scrolling its ancestors', () => {
        const container = document.createElement('div')
        const target = document.createElement('span')
        Object.defineProperties(container, {
            clientHeight: { configurable: true, value: 400 },
            scrollHeight: { configurable: true, value: 2_000 },
        })
        container.scrollTop = 0
        container.getBoundingClientRect = () => ({ top: 100, height: 400 } as DOMRect)
        target.getBoundingClientRect = () => ({ top: 1_100, height: 20 } as DOMRect)

        scrollFileLineToCenter(container, target)

        expect(scrollIntoViewMock).toHaveBeenCalledWith({ block: 'center', inline: 'nearest' })
        expect(container.scrollTop).toBe(810)
    })
})
