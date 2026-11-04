type Titles = { work: string; regular: string }
type State = { draft: Titles | null; status: 'idle' | 'saving' | 'error' }
const storageKey = 'hapi.browser-title-draft'
let state: State = { draft: null, status: 'idle' }
let save: ((titles: Titles) => Promise<void>) | null = null
let running = false
let revision = 0
const listeners = new Set<() => void>()

function publish(next: State) {
    state = next
    listeners.forEach(listener => listener())
}
function persist(draft: Titles | null) {
    try {
        if (draft) sessionStorage.setItem(storageKey, JSON.stringify(draft))
        else sessionStorage.removeItem(storageKey)
    } catch { /* beforeunload still protects an unsaved draft */ }
}
function restore(): Titles | null {
    try {
        const value = JSON.parse(sessionStorage.getItem(storageKey) || 'null')
        return value && typeof value.work === 'string' && typeof value.regular === 'string' ? value : null
    } catch { return null }
}

export const browserTitleDraft = {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    snapshot: () => state,
    init(saveTitles: (titles: Titles) => Promise<void>, titles: Titles, loaded = true) {
        save = saveTitles
        if (!state.draft) {
            const draft = restore()
            if (!draft && !loaded) return
            publish({ draft: draft ?? titles, status: draft ? 'saving' : 'idle' })
            if (draft) void flush()
        }
    },
    edit(draft: Titles) {
        revision++
        persist(draft)
        publish({ draft, status: 'saving' })
        void flush()
    },
    retry() { if (state.draft) { publish({ ...state, status: 'saving' }); void flush() } },
}

async function flush() {
    if (running || !save || !state.draft) return
    running = true
    while (state.draft && state.status === 'saving') {
        const current = state.draft
        const version = revision
        try {
            await save({ work: current.work.trim() || 'HAPI', regular: current.regular.trim() || 'HAPI' })
            if (version === revision) {
                persist(null)
                publish({ draft: current, status: 'idle' })
            }
        } catch {
            if (version === revision) publish({ draft: current, status: 'error' })
        }
    }
    running = false
}

if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', event => {
        if (state.status !== 'idle') { event.preventDefault(); event.returnValue = '' }
    })
}
