import { createRoot } from 'react-dom/client'
import { useState } from 'react'
import { ShareTurnDialog } from '@/components/AssistantChat/ShareTurnDialog'
import { I18nProvider } from '@/lib/i18n-context'

const RED_PNG =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

const snapshotHtml = (rev: number) => `
<button
    type="button"
    data-image-preview-trigger=""
    data-image-preview-file-name="red.png"
    data-image-preview-label="red"
>
    <img src="${RED_PNG}" alt="red" />
</button>
<p data-revision="${rev}">rev ${rev}</p>
`

function Demo() {
    const [open, setOpen] = useState(false)
    const [revision, setRevision] = useState(0)
    // Intentionally wrap snapshots in a fresh array every render so the
    // dialog sees a new reference; this simulates the real-world flicker
    // where HappyThread re-renders while the dialog is open.
    const snapshots = [{ html: snapshotHtml(revision), text: 'image' + revision }]

    return (
        <div>
            <div className="flex gap-2">
                <button
                    type="button"
                    onClick={() => setOpen(true)}
                    className="rounded bg-blue-500 px-4 py-2 text-white"
                >
                    Open Share Turn Dialog
                </button>
                <button
                    id="bump-snapshots"
                    type="button"
                    onClick={() => setRevision((r) => r + 1)}
                    className="fixed right-4 top-4 z-[60] rounded bg-red-500 px-3 py-2 text-white"
                >
                    bump rev ({revision})
                </button>
            </div>
            <ShareTurnDialog
                isOpen={open}
                title="Test Turn"
                metadataItems={[]}
                sourceSnapshots={snapshots}
                onClose={() => setOpen(false)}
            />
        </div>
    )
}

const root = document.getElementById('root')
if (!root) throw new Error('missing #root')

createRoot(root).render(
    <I18nProvider>
        <Demo />
    </I18nProvider>,
)