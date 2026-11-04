import { beforeEach, describe, expect, it, vi } from 'vitest'

const tick = () => new Promise(resolve => setTimeout(resolve, 0))

describe('browser title autosave', () => {
    beforeEach(() => { vi.resetModules(); sessionStorage.clear() })

    it('keeps later edits while a save is in flight and restores them after navigation or reload', async () => {
        const { browserTitleDraft: draft } = await import('./browserTitleDraft')
        let finish!: () => void
        const save = vi.fn().mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve })).mockResolvedValue(undefined)
        draft.init(save, { work: 'old', regular: 'old' })
        draft.edit({ work: 'first', regular: 'old' })
        draft.edit({ work: 'first', regular: 'latest' })
        expect(JSON.parse(sessionStorage.getItem('hapi.browser-title-draft')!)).toEqual({ work: 'first', regular: 'latest' })
        finish()
        await tick()
        expect(save).toHaveBeenLastCalledWith({ work: 'first', regular: 'latest' })
        expect(draft.snapshot()).toEqual({ draft: { work: 'first', regular: 'latest' }, status: 'idle' })
        expect(sessionStorage.getItem('hapi.browser-title-draft')).toBeNull()
    })

    it('retains failed input across reload and retries with empty fields normalized', async () => {
        const { browserTitleDraft: draft } = await import('./browserTitleDraft')
        draft.init(vi.fn().mockRejectedValue(new Error('offline')), { work: 'old', regular: 'old' })
        draft.edit({ work: '', regular: 'new' })
        await tick()
        expect(draft.snapshot().status).toBe('error')
        vi.resetModules()
        const { browserTitleDraft: restored } = await import('./browserTitleDraft')
        const save = vi.fn().mockResolvedValue(undefined)
        restored.init(save, { work: 'old', regular: 'old' })
        await tick()
        expect(save).toHaveBeenCalledWith({ work: 'HAPI', regular: 'new' })
        expect(restored.snapshot().draft).toEqual({ work: '', regular: 'new' })
    })
})
