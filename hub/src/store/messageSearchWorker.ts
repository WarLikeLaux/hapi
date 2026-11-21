import { Database } from 'bun:sqlite'
import { searchMessages, type MessageSearchOptions, type MessageSearchResult } from './messages'

export type SearchJob = {
    id: number
    dbPath: string
    query: string
    options?: MessageSearchOptions
}

export type SearchReply = { id: number } & (
    { result: MessageSearchResult } | { error: string }
)

let db: Database | undefined

addEventListener('message', ({ data }: MessageEvent<SearchJob>) => {
    const { id, dbPath, query, options } = data
    let reply: SearchReply
    try {
        if (!db) {
            db = new Database(dbPath, { readonly: true, strict: true })
            db.exec('PRAGMA busy_timeout = 1000')
        }
        const connection = db
        // Counts and hits must come from the same snapshot even while the Hub writes.
        const result = connection.transaction(() => searchMessages(connection, query, options))()
        reply = { id, result }
    } catch (error) {
        reply = { id, error: error instanceof Error ? error.message : String(error) }
    }
    postMessage(reply)
})
