import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)
const CACHE_TTL_MS = 60_000
const MAX_CACHE_ENTRIES = 256

/** One cache per RPC owner; concurrent status polls share the same lookup. */
export function createGitLabMergeRequestLookup(): (createUrl: string, cwd: string) => Promise<string | null> {
    const cache = new Map<string, { expiresAt: number; result: Promise<string | null> }>()

    return (createUrl, cwd) => {
        const cached = cache.get(createUrl)
        if (cached && cached.expiresAt > Date.now()) return cached.result

        const result = findMergeRequest(createUrl, cwd)
        cache.delete(createUrl)
        if (cache.size >= MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value!)
        cache.set(createUrl, { expiresAt: Date.now() + CACHE_TTL_MS, result })
        return result
    }
}

async function findMergeRequest(createUrl: string, cwd: string): Promise<string | null> {
    try {
        const projectUrl = new URL(createUrl)
        const projectPath = projectUrl.pathname.replace(/\/-\/merge_requests\/new$/, '').replace(/^\//, '')
        const branch = projectUrl.searchParams.get('merge_request[source_branch]')
        if (!branch) return null

        const query = new URLSearchParams({
            state: 'opened', source_branch: branch, scope: 'all',
            order_by: 'updated_at', sort: 'desc', per_page: '100',
        })
        const { stdout } = await execFileAsync('glab', [
            'api', `projects/${encodeURIComponent(projectPath)}/merge_requests?${query}`,
            '--hostname', projectUrl.host,
        ], { cwd, timeout: 4_000, maxBuffer: 2 * 1024 * 1024 })
        const reviews: unknown = JSON.parse(stdout)
        if (!Array.isArray(reviews)) return null

        for (const review of reviews) {
            if (!review || typeof review !== 'object'
                || review.state !== 'opened' || review.source_branch !== branch
                || typeof review.source_project_id !== 'number'
                || review.source_project_id !== review.project_id
                || typeof review.web_url !== 'string') continue

            const url = new URL(review.web_url)
            const prefix = `/${projectPath}/-/merge_requests/`
            if (url.origin !== projectUrl.origin || url.username || url.password
                || !url.pathname.startsWith(prefix)
                || !/^\d+$/.test(url.pathname.slice(prefix.length))) continue
            return url.toString()
        }
    } catch {
        // Missing glab, authentication, network and API errors must not break Git status.
    }
    return null
}
