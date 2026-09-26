import { describe, expect, it } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Store } from './index'
import {
    MESSAGE_SEARCH_TEXT_LIMIT,
    buildSearchSnippet,
    escapeLikePattern,
    extractMessageSearchDocument,
    messageSearchText,
    toMessageSearchText
} from './messageSearch'

function userText(text: string, meta: Record<string, unknown> = {}) {
    return { role: 'user', content: { type: 'text', text }, meta }
}

function assistantFinal(text: string) {
    return {
        role: 'agent',
        content: { type: 'output', data: { type: 'assistant', message: { content: [{ type: 'text', text }] } } }
    }
}

describe('extractMessageSearchDocument', () => {
    it('indexes user text prompts', () => {
        const doc = extractMessageSearchDocument(userText('починить деплой'))
        expect(doc).toEqual({ role: 'user', text: 'починить деплой' })
    })

    it('indexes agent assistant text blocks as finals', () => {
        const doc = extractMessageSearchDocument(assistantFinal('Готово: всё работает'))
        expect(doc).toEqual({ role: 'agent', text: 'Готово: всё работает' })
    })

    it('indexes codex final messages', () => {
        const content = { role: 'agent', content: { type: 'codex', data: { type: 'message', message: 'Codex ответ' } } }
        expect(extractMessageSearchDocument(content)).toEqual({ role: 'agent', text: 'Codex ответ' })
    })

    it('skips tool traffic, reasoning and bookkeeping rows', () => {
        const rows = [
            { role: 'agent', content: { type: 'output', data: { type: 'tool_use', name: 'Bash' } } },
            { role: 'agent', content: { type: 'output', data: { type: 'tool_result', content: 'ok' } } },
            { role: 'agent', content: { type: 'output', data: { type: 'reasoning', message: 'думаю' } } },
            { role: 'agent', content: { type: 'output', data: { type: 'assistant', isMeta: true, message: { content: [{ type: 'text', text: 'meta' }] } } } },
            { role: 'agent', content: { type: 'output', data: { type: 'assistant', isCompactSummary: true, message: { content: [{ type: 'text', text: 'compact' }] } } } },
            { role: 'system', content: { type: 'event', data: { type: 'lifecycle', subtype: 'session_started' } } }
        ]
        for (const row of rows) {
            expect(extractMessageSearchDocument(row)).toBeNull()
        }
    })

    it('joins multi-part user arrays', () => {
        const content = {
            role: 'user',
            content: [
                { type: 'text', text: 'первая часть' },
                { type: 'input_text', text: 'вторая часть' },
                { type: 'image', source: { kind: 'bytes' } }
            ]
        }
        expect(extractMessageSearchDocument(content)).toEqual({ role: 'user', text: 'первая часть\nвторая часть' })
    })
})

describe('toMessageSearchText', () => {
    it('lowercases for non-ASCII case folding at query time', () => {
        expect(toMessageSearchText({ role: 'user', text: 'ПриВет Мир' })).toBe('привет мир')
    })

    it('caps pathological extracts', () => {
        const long = 'x'.repeat(MESSAGE_SEARCH_TEXT_LIMIT + 10)
        expect(toMessageSearchText({ role: 'agent', text: long })).toHaveLength(MESSAGE_SEARCH_TEXT_LIMIT)
    })

    it('messageSearchText returns null for bookkeeping rows', () => {
        expect(messageSearchText({ role: 'agent', content: { type: 'output', data: { type: 'tool_use', name: 'Bash' } } })).toBeNull()
    })
})

describe('buildSearchSnippet', () => {
    it('returns offsets into the windowed snippet', () => {
        const text = 'a'.repeat(200) + ' цельный текст ' + 'b'.repeat(200)
        const snippet = buildSearchSnippet(text, 'цельный текст')
        expect(snippet).not.toBeNull()
        // at = 201, radius = 64 → window [137, 278); match sits 64 chars in.
        expect(snippet!.matchStart).toBe(64)
        expect(snippet!.matchLength).toBe('цельный текст'.length)
        expect(snippet!.snippet.slice(snippet!.matchStart, snippet!.matchStart + snippet!.matchLength)).toBe('цельный текст')
    })

    it('window stays inside bounds near the start', () => {
        const snippet = buildSearchSnippet('короткий текст', 'короткий')
        expect(snippet).toEqual({ snippet: 'короткий текст', matchStart: 0, matchLength: 8 })
    })
})

describe('escapeLikePattern', () => {
    it('escapes LIKE wildcards and the escape character', () => {
        expect(escapeLikePattern('100%_done\\now')).toBe('100\\%\\_done\\\\now')
    })
})

describe('MessageStore.searchMessages', () => {
    function makeStore() {
        return new Store(':memory:')
    }

    function makeSession(store: Store, tag: string) {
        return store.sessions.getOrCreateSession(tag, { path: `/tmp/${tag}` }, null, 'default')
    }

    it('finds user and agent finals case-insensitively across sessions', () => {
        const store = makeStore()
        const s1 = makeSession(store, 'search-s1')
        const s2 = makeSession(store, 'search-s2')
        store.messages.addMessage(s1.id, userText('Сломалась Регистрация'), 'l1', null, 1000)
        store.messages.addMessage(s1.id, assistantFinal('Готово: регистрация починена'), 'l2', null, 2000)
        store.messages.addMessage(s1.id, { role: 'agent', content: { type: 'output', data: { type: 'tool_use', name: 'Bash' } } }, 'l3', null, 2500)
        store.messages.addMessage(s2.id, { role: 'agent', content: { type: 'codex', data: { type: 'message', message: 'тут про ДЕПЛОЙ' } } }, 'k1', null, 3000)

        const hits = store.messages.searchMessages('регистрация')
        expect(hits.total).toBe(2)
        expect(hits.hits.map((hit) => hit.role)).toEqual(['agent', 'user'])
        expect(hits.hits.every((hit) => hit.sessionId === s1.id)).toBe(true)
        expect(hits.sessions).toEqual([{ sessionId: s1.id, count: 2 }])

        const agent = store.messages.searchMessages('деплой')
        expect(agent.total).toBe(1)
        expect(agent.hits[0].role).toBe('agent')
        expect(agent.hits[0].snippet).toContain('ДЕПЛОЙ')
        expect(agent.hits[0].matchLength).toBe('деплой'.length)

        // Prefix partials behave like the session-list search.
        expect(store.messages.searchMessages('регистр').total).toBe(2)
        // No rows for bookkeeping-only corpus.
        expect(store.messages.searchMessages('Bash').total).toBe(0)
    })

    it('returns match offsets that resolve inside the original text', () => {
        const store = makeStore()
        const session = makeSession(store, 'search-offset')
        const text = 'итоговый ответ со словом Янтарный внутри'
        store.messages.addMessage(session.id, assistantFinal(text), 'l1', null, 1000)

        const hit = store.messages.searchMessages('янтарный').hits[0]
        expect(hit.snippet.slice(hit.matchStart, hit.matchStart + hit.matchLength).toLowerCase()).toBe('янтарный')
    })

    it('treats LIKE wildcards as literal characters', () => {
        const store = makeStore()
        const session = makeSession(store, 'search-wildcard')
        store.messages.addMessage(session.id, userText('жду 100% готовности'), 'l1', null, 1000)
        store.messages.addMessage(session.id, userText('ждём полной готовности'), 'l2', null, 1100)

        // Literal % exists only in the first row: a wildcard query must match
        // exactly that one, not every row.
        expect(store.messages.searchMessages('%').total).toBe(1)
        expect(store.messages.searchMessages('_ готовности').total).toBe(0)
    })

    it('re-indexes edited native queued messages', () => {
        const store = makeStore()
        const session = makeSession(store, 'search-native')
        store.messages.syncNativeQueuedMessage(session.id, 'nat-1', 'первый вариант текста')
        expect(store.messages.searchMessages('второй вариант').total).toBe(0)

        store.messages.syncNativeQueuedMessage(session.id, 'nat-1', 'второй вариант текста')
        const hits = store.messages.searchMessages('второй вариант')
        expect(hits.total).toBe(1)
        expect(hits.hits[0].role).toBe('user')
    })

    it('scopes hits to one session and skips the sessions aggregate', () => {
        const store = makeStore()
        const s1 = makeSession(store, 'search-scope-1')
        const s2 = makeSession(store, 'search-scope-2')
        store.messages.addMessage(s1.id, userText('слово в первом чате'), 'l1', null, 1000)
        store.messages.addMessage(s2.id, userText('слово во втором чате'), 'k1', null, 1100)

        const scoped = store.messages.searchMessages('слово', { sessionId: s2.id })
        expect(scoped.total).toBe(1)
        expect(scoped.sessions).toEqual([])
        expect(scoped.hits).toHaveLength(1)
        expect(scoped.hits[0]!.sessionId).toBe(s2.id)
        expect(scoped.hasMore).toBe(false)
    })

    it('pages through older hits with the keyset cursor', () => {
        const store = makeStore()
        const session = makeSession(store, 'search-page')
        for (let i = 0; i < 5; i++) {
            store.messages.addMessage(session.id, userText(`страница совпадение ${i}`), `l${i}`, null, 1000 + i)
        }

        const page1 = store.messages.searchMessages('совпадение', { hitLimit: 2 })
        expect(page1.total).toBe(5)
        expect(page1.hits.map((hit) => hit.createdAt)).toEqual([1004, 1003])
        expect(page1.hasMore).toBe(true)

        const last1 = page1.hits[page1.hits.length - 1]!
        const page2 = store.messages.searchMessages('совпадение', {
            hitLimit: 2,
            beforeCreatedAt: last1.createdAt,
            beforeSeq: last1.seq
        })
        expect(page2.hits.map((hit) => hit.createdAt)).toEqual([1002, 1001])
        expect(page2.hasMore).toBe(true)

        const last2 = page2.hits[page2.hits.length - 1]!
        const page3 = store.messages.searchMessages('совпадение', {
            hitLimit: 2,
            beforeCreatedAt: last2.createdAt,
            beforeSeq: last2.seq
        })
        expect(page3.hits.map((hit) => hit.createdAt)).toEqual([1000])
        expect(page3.hasMore).toBe(false)

        // Session scope and the cursor combine for per-chat paging; the
        // remaining tail fits the page exactly, so hasMore is false.
        const scopedPage = store.messages.searchMessages('совпадение', {
            sessionId: session.id,
            hitLimit: 3,
            beforeCreatedAt: last1.createdAt,
            beforeSeq: last1.seq
        })
        expect(scopedPage.total).toBe(5)
        expect(scopedPage.sessions).toEqual([])
        expect(scopedPage.hits).toHaveLength(3)
        expect(scopedPage.hasMore).toBe(false)
    })

    it('copies keep their search extract when merged into a fork', () => {
        const store = makeStore()
        const source = makeSession(store, 'search-copy-src')
        const target = makeSession(store, 'search-copy-dst')
        const added = store.messages.addMessage(source.id, assistantFinal('уникальное слово для поиска'), 'l1', null, 1000)

        store.messages.copyMessageToSession(target.id, {
            content: added.content,
            createdAt: added.createdAt,
            localId: added.localId,
            invokedAt: added.invokedAt,
            scheduledAt: added.scheduledAt,
            deliveryState: added.deliveryState
        })
        const hits = store.messages.searchMessages('уникальное слово')
        expect(hits.total).toBe(2)
        expect(hits.sessions.map((row) => row.sessionId).sort()).toEqual([source.id, target.id].sort())
    })
})

/**
 * V33→V34 migration: search_text column added and backfilled from existing
 * content. Builds the "old" shape by dropping the column from a fresh v34 DB
 * (SQLite DROP COLUMN) and rewinding user_version, so the test exercises the
 * real ALTER + backfill path against realistic rows.
 */
describe('Store V33→V34 migration: search_text backfill', () => {
    it('adds the column and backfills extracts for existing rows', () => {
        const dir = mkdtempSync(join(tmpdir(), 'hapi-migration-v34-test-'))
        const dbPath = join(dir, 'test.db')
        let store: Store | undefined
        try {
            // Seed rows with real content through the current store, then rewind.
            store = new Store(dbPath)
            const session = store.sessions.getOrCreateSession('migration-seed', { path: '/tmp/migration-seed' }, null, 'default')
            store.messages.addMessage(session.id, userText('миграционное слово в промпте'), 'l1', null, 1000)
            store.messages.addMessage(session.id, assistantFinal('миграционное слово в ответе'), 'l2', null, 2000)
            store.messages.addMessage(session.id, { role: 'agent', content: { type: 'output', data: { type: 'tool_use', name: 'Bash' } } }, 'l3', null, 2500)
            store.close()
            store = undefined

            const raw = new Database(dbPath, { readwrite: true })
            raw.exec('ALTER TABLE messages DROP COLUMN search_text')
            raw.exec('PRAGMA user_version = 33')
            raw.close()

            store = new Store(dbPath)
            const rawCols = new Database(dbPath, { readonly: true })
            const cols = rawCols.query('PRAGMA table_info(messages)').all()
                .map((column) => (column as { name: string }).name)
            rawCols.close()
            expect(cols).toContain('search_text')

            const hits = store.messages.searchMessages('миграционное слово')
            expect(hits.total).toBe(2)
            expect(hits.hits.map((hit) => hit.role).sort()).toEqual(['agent', 'user'])

            const rawAfter = new Database(dbPath, { readonly: true })
            const nulls = rawAfter.query('SELECT COUNT(*) AS c FROM messages WHERE search_text IS NULL').get() as { c: number }
            const toolRows = rawAfter.query('SELECT COUNT(*) AS c FROM messages').get() as { c: number }
            rawAfter.close()
            expect(nulls.c).toBe(toolRows.c - 2)
        } finally {
            store?.close()
            rmSync(dir, { recursive: true, force: true })
        }
    })
})
