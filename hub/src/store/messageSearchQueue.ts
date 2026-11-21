import type { MessageSearchOptions, MessageSearchResult } from './messages'
import type { SearchJob, SearchReply } from './messageSearchWorker'

const MAX_PENDING_SEARCHES = 8
const SEARCH_TIMEOUT_MS = 25_000

export class MessageSearchUnavailable extends Error {}

type PendingSearch = {
    job: SearchJob
    finish: (outcome: MessageSearchResult | Error) => void
}

export class MessageSearchQueue {
    private worker: Worker | undefined
    private activeId: number | undefined
    private nextId = 0
    private readonly pending = new Map<number, PendingSearch>()

    constructor(private readonly dbPath: string) {}

    search(query: string, options?: MessageSearchOptions, signal?: AbortSignal): Promise<MessageSearchResult> {
        if (this.pending.size >= MAX_PENDING_SEARCHES) {
            return Promise.reject(new MessageSearchUnavailable('Message search is busy. Try again.'))
        }

        return new Promise((resolve, reject) => {
            const id = ++this.nextId
            const abort = () => finish(new MessageSearchUnavailable('Message search was cancelled.'))
            const timer = setTimeout(() => {
                finish(new MessageSearchUnavailable('Message search timed out. Try again.'))
            }, SEARCH_TIMEOUT_MS)
            const finish = (outcome: MessageSearchResult | Error) => {
                this.pending.delete(id)
                clearTimeout(timer)
                signal?.removeEventListener('abort', abort)
                if (outcome instanceof Error) reject(outcome)
                else resolve(outcome)
            }

            if (signal?.aborted) {
                abort()
                return
            }
            signal?.addEventListener('abort', abort, { once: true })
            this.pending.set(id, { job: { id, dbPath: this.dbPath, query, options }, finish })
            this.dispatch()
        })
    }

    close(): void {
        const worker = this.worker
        this.worker = undefined
        this.activeId = undefined
        worker?.terminate()
        const error = new MessageSearchUnavailable('Message search is unavailable. Try again.')
        for (const search of this.pending.values()) search.finish(error)
    }

    private dispatch(): void {
        // A cancelled or timed-out query can still be inside SQLite. Wait for
        // its reply before dispatching the next query to the same connection.
        if (this.activeId !== undefined) return
        const next = this.pending.values().next().value
        if (!next) return

        try {
            if (!this.worker) {
                // Bundled Hub and CLI builds emit the worker beside their entry point.
                const workerFile = import.meta.path.endsWith('.ts') ? './messageSearchWorker.ts' : './messageSearchWorker.js'
                const worker = new Worker(new URL(workerFile, import.meta.url))
                this.worker = worker
                worker.addEventListener('message', ({ data }: MessageEvent<SearchReply>) => {
                    if (worker !== this.worker || data.id !== this.activeId) return
                    this.activeId = undefined
                    const search = this.pending.get(data.id)
                    if ('result' in data) {
                        search?.finish(data.result)
                    } else {
                        console.error('[Message search] SQLite query failed:', data.error)
                        search?.finish(new MessageSearchUnavailable('Message search is unavailable. Try again.'))
                    }
                    this.dispatch()
                })
                worker.addEventListener('close', () => {
                    if (worker === this.worker) this.close()
                })
                worker.addEventListener('error', (event) => {
                    if (worker !== this.worker) return
                    console.error('[Message search] Worker failed:', event.message)
                    this.close()
                })
            }
            this.activeId = next.job.id
            this.worker.postMessage(next.job)
        } catch (error) {
            console.error('[Message search] Could not dispatch query:', error)
            this.close()
        }
    }
}
