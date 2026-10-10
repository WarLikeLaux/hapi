/**
 * Resume-if-inactive + wait-active + POST /api/sessions/:id/messages,
 * plus read-only inspectPeer (GET session + messages, never resume).
 *
 * Shared by `hapi ping-peer` / `hapi inspect-peer` and MCP `ping_peer` /
 * `inspect_peer`. Uses the same hub JWT flow as the web app
 * (`POST /api/auth` with CLI_API_TOKEN), scoped to the token's namespace.
 * Callers must not invent parallel auth or arbitrary hosts.
 */

import axios, { type AxiosInstance } from 'axios'
import { randomUUID } from 'node:crypto'
import { extractAssistantPlainText, isObject } from '@hapi/protocol'
import { normalizeSessionIdPrefix } from '@hapi/protocol/sessionCitation'
import { configuration } from '@/configuration'
import { getAuthToken } from '@/api/auth'
import { buildHubRequestHeaders } from '@/api/hubExtraHeaders'

export type PingPeerErrorCode =
    | 'bad_args'
    | 'auth_failed'
    | 'not_found'
    | 'ambiguous'
    | 'busy'
    | 'archive_failed'
    | 'resume_failed'
    | 'timeout'
    | 'send_failed'

export class PingPeerError extends Error {
    readonly code: PingPeerErrorCode

    constructor(code: PingPeerErrorCode, message: string) {
        super(message)
        this.name = 'PingPeerError'
        this.code = code
    }
}

export type PingPeerSessionSummary = {
    id: string
    active: boolean
    thinking?: boolean
    updatedAt?: number
    metadata?: {
        name?: string
        flavor?: string | null
        path?: string | null
        lifecycleState?: string | null
        piSessionId?: string
        summary?: { text?: string } | null
    } | null
}

export type PingPeerOptions = {
    sessionIdPrefix: string
    message: string
    localId?: string
    waitActiveSecs?: number
    apiUrl?: string
    accessToken?: string
    http?: AxiosInstance
    sleep?: (ms: number) => Promise<void>
    now?: () => number
    onProgress?: (message: string) => void
}

export type PingPeerResult = {
    sessionId: string
    name: string
    resumed: boolean
}

export type ListPeerSessionsOptions = {
    apiUrl?: string
    accessToken?: string
    http?: AxiosInstance
    limit?: number
    /** Hub sort before limit truncation. Peer discovery defaults to newest updatedAt. */
    order?: 'updatedAt'
}

const DEFAULT_WAIT_ACTIVE_SECS = 60
const POLL_ACTIVE_MS = 2_000
const POLL_PI_READY_MS = 1_000

function defaultSleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

const AUTH_RECOVERY_HINT =
    'On a remote runner, set HAPI_API_URL to the runner hub, and set CLI_API_TOKEN ' +
    'or run `hapi auth login` to save the token. Inside a HAPI session prefer MCP ' +
    '`list_peers` / `ping_peer` / `inspect_peer`, which use the session CLI credentials.'

function resolveApiUrl(apiUrl?: string): string {
    const raw = (apiUrl ?? configuration.apiUrl).trim().replace(/\/+$/, '')
    if (!raw) {
        throw new PingPeerError(
            'bad_args',
            `HAPI API URL is empty. ${AUTH_RECOVERY_HINT}`
        )
    }
    // Peer messaging only targets the configured hub - never accept host overrides
    // from MCP tool args (security: same hub/token/namespace only).
    return raw
}

function resolveAccessToken(accessToken?: string): string {
    let token = ''
    try {
        token = (accessToken ?? getAuthToken()).trim()
    } catch {
        token = (accessToken ?? '').trim()
    }
    if (!token) {
        throw new PingPeerError(
            'bad_args',
            `CLI_API_TOKEN is required (run \`hapi auth login\`). ${AUTH_RECOVERY_HINT}`
        )
    }
    return token
}

function authFailedMessage(apiUrl: string, detail: string): string {
    return `failed to exchange access token for JWT (${detail}). Hub URL: ${apiUrl}. ${AUTH_RECOVERY_HINT}`
}

async function exchangeJwt(
    apiUrl: string,
    accessToken: string,
    http: AxiosInstance
): Promise<string> {
    try {
        const response = await http.post(
            `${apiUrl}/api/auth`,
            { accessToken },
            {
                headers: buildHubRequestHeaders({ 'Content-Type': 'application/json' }),
                timeout: 10_000,
                validateStatus: () => true
            }
        )
        const token = typeof response.data?.token === 'string' ? response.data.token : ''
        if (response.status < 200 || response.status >= 300 || !token) {
            const detail = typeof response.data?.error === 'string'
                ? response.data.error
                : `HTTP ${response.status}`
            throw new PingPeerError('auth_failed', authFailedMessage(apiUrl, detail))
        }
        return token
    } catch (error) {
        if (error instanceof PingPeerError) {
            throw error
        }
        throw new PingPeerError(
            'auth_failed',
            authFailedMessage(apiUrl, error instanceof Error ? error.message : String(error))
        )
    }
}

function authHeaders(jwt: string): Record<string, string> {
    return buildHubRequestHeaders({
        Authorization: `Bearer ${jwt}`,
        'Content-Type': 'application/json'
    })
}

/** Authenticated access to the configured hub, scoped to this CLI's namespace. */
export async function connectPeerHub() {
    const apiUrl = resolveApiUrl()
    const http = axios
    const jwt = await exchangeJwt(apiUrl, resolveAccessToken(), http)
    async function request<T>(method: 'get' | 'post', path: string, body?: unknown): Promise<T> {
        const config = { headers: authHeaders(jwt), timeout: 120_000, validateStatus: () => true }
        const response = method === 'get'
            ? await http.get(`${apiUrl}/api${path}`, config)
            : await http.post(`${apiUrl}/api${path}`, body, config)
        if (response.status < 200 || response.status >= 300) {
            throw new Error(`${method.toUpperCase()} ${path}: ${response.data?.error ?? `HTTP ${response.status}`}`)
        }
        return response.data as T
    }
    return {
        get: <T>(path: string) => request<T>('get', path),
        post: <T>(path: string, body: unknown) => request<T>('post', path, body),
    }
}

export function resolveSessionByPrefix(
    sessions: PingPeerSessionSummary[],
    prefix: string
): PingPeerSessionSummary {
    const trimmed = prefix.trim()
    if (!trimmed) {
        throw new PingPeerError('bad_args', 'session id prefix is required')
    }

    const exact = sessions.filter((session) => session.id === trimmed)
    if (exact.length === 1) {
        return exact[0]!
    }

    const matches = sessions.filter((session) => session.id.startsWith(trimmed))
    if (matches.length === 0) {
        throw new PingPeerError('not_found', `no session matching prefix '${trimmed}'`)
    }
    if (matches.length > 1) {
        const sample = matches.slice(0, 5).map((session) => session.id.slice(0, 8)).join(', ')
        throw new PingPeerError(
            'ambiguous',
            `prefix '${trimmed}' matches ${matches.length} sessions (${sample}${matches.length > 5 ? ', ...' : ''}); use a longer prefix`
        )
    }
    return matches[0]!
}

async function listSessions(
    apiUrl: string,
    jwt: string,
    http: AxiosInstance,
    options: { limit?: number; order?: 'updatedAt' } = {}
): Promise<PingPeerSessionSummary[]> {
    const params: Record<string, string | number> = {}
    if (options.limit !== undefined) {
        params.limit = options.limit
    }
    if (options.order !== undefined) {
        params.order = options.order
    }
    const response = await http.get(
        `${apiUrl}/api/sessions`,
        {
            headers: authHeaders(jwt),
            // Omit params when unbounded so ping/inspect keep full-namespace resolution.
            ...(Object.keys(params).length > 0 ? { params } : {}),
            timeout: 15_000,
            validateStatus: () => true
        }
    )
    if (response.status < 200 || response.status >= 300) {
        const detail = typeof response.data?.error === 'string'
            ? response.data.error
            : `HTTP ${response.status}`
        throw new PingPeerError(
            'auth_failed',
            `failed to list sessions (${detail}). Hub URL: ${apiUrl}. ${AUTH_RECOVERY_HINT}`
        )
    }
    const body = response.data
    const sessions = Array.isArray(body?.sessions)
        ? body.sessions
        : Array.isArray(body)
            ? body
            : null
    if (!sessions) {
        throw new PingPeerError('auth_failed', 'failed to list sessions (unexpected response)')
    }
    return sessions as PingPeerSessionSummary[]
}

async function getSession(
    apiUrl: string,
    jwt: string,
    sessionId: string,
    http: AxiosInstance
): Promise<PingPeerSessionSummary> {
    const response = await http.get(
        `${apiUrl}/api/sessions/${encodeURIComponent(sessionId)}`,
        {
            headers: authHeaders(jwt),
            timeout: 10_000,
            validateStatus: () => true
        }
    )
    if (response.status < 200 || response.status >= 300 || !response.data?.session) {
        const detail = typeof response.data?.error === 'string'
            ? response.data.error
            : `HTTP ${response.status}`
        throw new PingPeerError('not_found', `failed to load session ${sessionId} (${detail})`)
    }
    return response.data.session as PingPeerSessionSummary
}

async function resumeSession(
    apiUrl: string,
    jwt: string,
    sessionId: string,
    http: AxiosInstance
): Promise<void> {
    const response = await http.post(
        `${apiUrl}/api/sessions/${encodeURIComponent(sessionId)}/resume`,
        {},
        {
            headers: authHeaders(jwt),
            timeout: 30_000,
            validateStatus: () => true
        }
    )
    if (response.data?.type === 'success') {
        return
    }
    const detail = typeof response.data?.message === 'string'
        ? response.data.message
        : typeof response.data?.error === 'string'
            ? response.data.error
            : typeof response.data?.code === 'string'
                ? response.data.code
                : `HTTP ${response.status}`
    throw new PingPeerError('resume_failed', `resume failed: ${detail}`)
}

async function waitUntilActive(
    apiUrl: string,
    jwt: string,
    sessionId: string,
    waitActiveSecs: number,
    http: AxiosInstance,
    sleep: (ms: number) => Promise<void>,
    now: () => number,
    onProgress?: (message: string) => void
): Promise<void> {
    const deadline = now() + waitActiveSecs * 1000
    onProgress?.(`waiting up to ${waitActiveSecs}s for active state...`)
    while (now() < deadline) {
        const session = await getSession(apiUrl, jwt, sessionId, http)
        if (session.active) {
            return
        }
        await sleep(POLL_ACTIVE_MS)
    }
    throw new PingPeerError(
        'timeout',
        `session did not become active within ${waitActiveSecs}s; runner may have failed to spawn`
    )
}

async function waitForPiReady(
    apiUrl: string,
    jwt: string,
    sessionId: string,
    waitActiveSecs: number,
    http: AxiosInstance,
    sleep: (ms: number) => Promise<void>,
    now: () => number,
    onProgress?: (message: string) => void
): Promise<void> {
    // active can precede piSessionId (tiann/hapi#1143). Instant /messages before
    // get_state settles wedges (Prompt accepted / agent_start / silence).
    onProgress?.(`flavor=pi - waiting up to ${waitActiveSecs}s for metadata.piSessionId...`)
    const deadline = now() + waitActiveSecs * 1000
    while (now() < deadline) {
        const session = await getSession(apiUrl, jwt, sessionId, http)
        const piSessionId = session.metadata?.piSessionId
        if (typeof piSessionId === 'string' && piSessionId.length > 0) {
            onProgress?.(`piSessionId=${piSessionId}`)
            return
        }
        await sleep(POLL_PI_READY_MS)
    }
    throw new PingPeerError(
        'timeout',
        `piSessionId never appeared within ${waitActiveSecs}s; refusing to send (would likely wedge - see #1143)`
    )
}

async function sendMessage(
    apiUrl: string,
    jwt: string,
    sessionId: string,
    message: string,
    localId: string | undefined,
    http: AxiosInstance
): Promise<void> {
    const response = await http.post(
        `${apiUrl}/api/sessions/${encodeURIComponent(sessionId)}/messages`,
        { text: message, ...(localId ? { localId } : {}) },
        {
            headers: authHeaders(jwt),
            timeout: 30_000,
            validateStatus: () => true
        }
    )
    if (response.status >= 200 && response.status < 300 && response.data?.ok === true) {
        return
    }
    const detail = typeof response.data?.error === 'string'
        ? response.data.error
        : typeof response.data?.code === 'string'
            ? response.data.code
            : `HTTP ${response.status}`
    throw new PingPeerError('send_failed', `send failed: ${detail}`)
}

export async function listPeerSessions(
    options: ListPeerSessionsOptions = {}
): Promise<PingPeerSessionSummary[]> {
    const apiUrl = resolveApiUrl(options.apiUrl)
    const accessToken = resolveAccessToken(options.accessToken)
    const http = options.http ?? axios
    const jwt = await exchangeJwt(apiUrl, accessToken, http)
    return listSessions(apiUrl, jwt, http, {
        limit: options.limit ?? 200,
        order: options.order ?? 'updatedAt'
    })
}

export type FormatPeerSessionsListOptions = {
    /** Max rows to print (default 30). */
    maxRows?: number
    /** Omit this session id (the caller) from the shortlist. */
    excludeSessionId?: string
    /**
     * When the fetch was intentionally bounded, signal overflow without claiming
     * an exact omitted count from the sample.
     */
    hasMore?: boolean
}

const MAX_PEER_LABEL_CHARS = 255

/**
 * Hub fetch size for peer discovery: enough rows for the requested page, plus
 * padding for caller exclusion and an overflow probe. Caps at hub max (500).
 */
export function peerListFetchLimit(requestedLimit: number, options?: { excludeCaller?: boolean }): number {
    const limit = Math.max(1, Math.floor(requestedLimit))
    const pad = options?.excludeCaller ? 2 : 1
    return Math.min(500, limit + pad)
}

/**
 * Web-parity title for peer shortlists: name → summary.text → basename(path) → id prefix.
 * Collapses whitespace so agent-readable rows stay one line each.
 */
export function resolvePeerSessionLabel(session: PingPeerSessionSummary): string {
    const meta = session.metadata
    const pathLabel = meta?.path?.split(/[\\/]/).filter(Boolean).pop()?.trim()
    const raw = meta?.name?.trim()
        || meta?.summary?.text?.trim()
        || pathLabel
        || session.id.slice(0, 8)
    const collapsed = raw.replace(/\s+/g, ' ').trim()
    if (!collapsed) {
        return session.id.slice(0, 8)
    }
    return collapsed.length > MAX_PEER_LABEL_CHARS
        ? collapsed.slice(0, MAX_PEER_LABEL_CHARS)
        : collapsed
}

/**
 * Human/agent-readable shortlist for MCP `list_peers` and `hapi ping-peer --list`.
 * Newest `updatedAt` first. Same hub/namespace as the caller credentials.
 */
export function formatPeerSessionsList(
    sessions: PingPeerSessionSummary[],
    options: FormatPeerSessionsListOptions = {}
): string {
    const maxRows = options.maxRows ?? 30
    const excludeId = options.excludeSessionId?.trim() ?? ''
    const filtered = excludeId
        ? sessions.filter((session) => session.id !== excludeId)
        : sessions
    if (filtered.length === 0) {
        return 'No peer sessions found on this hub/namespace.'
    }
    const sorted = [...filtered].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
    const rows = sorted.slice(0, Math.max(1, maxRows)).map((session) => {
        const flavor = session.metadata?.flavor ?? '?'
        const name = resolvePeerSessionLabel(session)
        return `  ${session.id}  active=${session.active}  flavor=${flavor}  ${name}`
    })
    const omitted = sorted.length - rows.length
    if (options.hasMore) {
        rows.push('  … more sessions available (narrow with inspect_peer / ping_peer by id)')
    } else if (omitted > 0) {
        rows.push(`  … ${omitted} more (narrow with inspect_peer / ping_peer by id)`)
    }
    return rows.join('\n')
}

export async function pingPeer(options: PingPeerOptions): Promise<PingPeerResult> {
    const prefix = normalizeSessionIdPrefix(options.sessionIdPrefix ?? '')
    const message = options.message ?? ''
    if (!prefix) {
        throw new PingPeerError('bad_args', 'session id prefix is required')
    }
    if (!message) {
        throw new PingPeerError('bad_args', 'message is required')
    }

    const waitActiveSecs = options.waitActiveSecs ?? DEFAULT_WAIT_ACTIVE_SECS
    if (!Number.isFinite(waitActiveSecs) || waitActiveSecs <= 0) {
        throw new PingPeerError('bad_args', 'waitActiveSecs must be a positive number')
    }

    const apiUrl = resolveApiUrl(options.apiUrl)
    const accessToken = resolveAccessToken(options.accessToken)
    const http = options.http ?? axios
    const sleep = options.sleep ?? defaultSleep
    const now = options.now ?? Date.now
    const onProgress = options.onProgress

    const jwt = await exchangeJwt(apiUrl, accessToken, http)
    const sessions = await listSessions(apiUrl, jwt, http)
    const matched = resolveSessionByPrefix(sessions, prefix)
    const name = resolvePeerSessionLabel(matched)
    onProgress?.(`resolved ${matched.id}  active=${matched.active}  name="${name}"`)

    let resumed = false
    const ensureActive = async (progressMessage: string): Promise<PingPeerSessionSummary> => {
        const session = await getSession(apiUrl, jwt, matched.id, http)
        if (session.active) {
            return session
        }
        onProgress?.(progressMessage)
        await resumeSession(apiUrl, jwt, matched.id, http)
        resumed = true
        await waitUntilActive(apiUrl, jwt, matched.id, waitActiveSecs, http, sleep, now, onProgress)
        onProgress?.('session active')
        return getSession(apiUrl, jwt, matched.id, http)
    }

    // Prefer the list snapshot for the first resume decision, then re-check before
    // send so a flip to inactive between list and POST cannot 409 (#1195).
    if (!matched.active) {
        await ensureActive('requesting resume...')
    }

    let live = await ensureActive('session went inactive before send; requesting resume...')
    if (live.metadata?.flavor === 'pi') {
        await waitForPiReady(apiUrl, jwt, matched.id, waitActiveSecs, http, sleep, now, onProgress)
        const beforePiResume = resumed
        live = await ensureActive('session went inactive before send; requesting resume...')
        if (resumed && !beforePiResume && live.metadata?.flavor === 'pi') {
            // Fresh agent after mid-wait resume: wait for piSessionId again (#1143).
            await waitForPiReady(apiUrl, jwt, matched.id, waitActiveSecs, http, sleep, now, onProgress)
            live = await ensureActive('session went inactive before send; requesting resume...')
        }
    }

    onProgress?.(`sending message (${message.length} chars)...`)
    await sendMessage(apiUrl, jwt, matched.id, message, options.localId ?? randomUUID(), http)

    return {
        sessionId: matched.id,
        name,
        resumed
    }
}

export function exitCodeForPingPeerError(error: PingPeerError): number {
    switch (error.code) {
        case 'bad_args':
        case 'auth_failed':
        case 'not_found':
        case 'ambiguous':
            return 2
        case 'busy':
        case 'resume_failed':
            return 3
        case 'archive_failed':
        case 'timeout':
        case 'send_failed':
            return 4
        default:
            return 1
    }
}

// ── inspect_peer (read twin; no resume) ─────────────────────────────────────

export type InspectPeerOptions = {
    sessionIdPrefix: string
    /** Text messages to return (default 30, clamped 1..200). Tool-call rows are skipped and not counted. */
    messageLimit?: number
    /** Older-page cursor from a previous call's olderBeforeAt (pass together with beforeSeq). */
    beforeAt?: number
    /** Older-page cursor from a previous call's olderBeforeSeq (pass together with beforeAt). */
    beforeSeq?: number
    apiUrl?: string
    accessToken?: string
    http?: AxiosInstance
}

export type InspectPeerMessage = {
    id: string
    role: string
    text: string
    createdAt: number | null
}

export type InspectPeerResult = {
    sessionId: string
    name: string
    active: boolean
    thinking: boolean
    flavor: string | null
    path: string | null
    lifecycleState: string | null
    updatedAt: number | null
    messages: InspectPeerMessage[]
    /** Cursor for the next older page; null once the start of the session is reached. */
    olderBeforeAt: number | null
    olderBeforeSeq: number | null
}

const DEFAULT_INSPECT_MESSAGE_LIMIT = 30
const MAX_INSPECT_MESSAGE_LIMIT = 200
const MAX_SNIPPET_CHARS = 4_000
/** Hub /messages page size; schema max is 200. */
const HUB_RAW_PAGE_LIMIT = 200

function clampInspectMessageLimit(raw: number | undefined): number {
    const n = raw ?? DEFAULT_INSPECT_MESSAGE_LIMIT
    if (!Number.isFinite(n)) {
        throw new PingPeerError('bad_args', 'messageLimit must be a number')
    }
    return Math.min(MAX_INSPECT_MESSAGE_LIMIT, Math.max(1, Math.floor(n)))
}

function resolveInspectCursor(
    beforeAt: number | undefined,
    beforeSeq: number | undefined
): { at: number; seq: number } | null {
    const hasAt = beforeAt !== undefined
    const hasSeq = beforeSeq !== undefined
    if (hasAt !== hasSeq) {
        throw new PingPeerError('bad_args', 'beforeAt and beforeSeq must be provided together')
    }
    if (!hasAt || !hasSeq) return null
    if (!Number.isFinite(beforeAt) || !Number.isFinite(beforeSeq)) {
        throw new PingPeerError('bad_args', 'beforeAt and beforeSeq must be numbers')
    }
    return { at: Math.floor(beforeAt), seq: Math.floor(beforeSeq) }
}

function extractUserPlainText(inner: unknown): string | null {
    if (typeof inner === 'string' && inner.trim()) return inner
    if (!isObject(inner)) return null
    if (typeof inner.text === 'string' && inner.text.trim()) return inner.text
    if (isObject(inner.content) && typeof inner.content.text === 'string' && inner.content.text.trim()) {
        return inner.content.text
    }
    return null
}

/** Best-effort text from a hub message row; skip tool-call / empty noise. */
export function extractInspectMessageSnippet(content: unknown): InspectPeerMessage | null {
    if (!isObject(content)) return null
    const role = typeof content.role === 'string' ? content.role : 'unknown'
    const inner = content.content
    let text: string | null = null
    if (role === 'user') {
        text = extractUserPlainText(inner)
    } else {
        text = extractAssistantPlainText(inner)
        if (!text) text = extractUserPlainText(inner)
    }
    if (!text) return null
    // Keep internal newlines (code blocks survive); only trim the edges.
    const trimmed = text.replace(/^[\s\uFEFF]+|[\s\uFEFF]+$/g, '')
    if (!trimmed) return null
    const snippet = trimmed.length > MAX_SNIPPET_CHARS
        ? `${trimmed.slice(0, MAX_SNIPPET_CHARS)}…`
        : trimmed
    return {
        id: typeof content.id === 'string' ? content.id : '',
        role,
        text: snippet,
        createdAt: null
    }
}

type InspectRawPage = {
    rows: unknown[]
    nextBeforeAt: number | null
    nextBeforeSeq: number | null
}

type InspectMessagesPage = {
    messages: InspectPeerMessage[]
    olderBeforeAt: number | null
    olderBeforeSeq: number | null
}

async function fetchInspectRawPage(
    apiUrl: string,
    jwt: string,
    sessionId: string,
    cursor: { at: number; seq: number } | null,
    http: AxiosInstance
): Promise<InspectRawPage> {
    const params: Record<string, number> = { limit: HUB_RAW_PAGE_LIMIT }
    if (cursor) {
        params.beforeAt = cursor.at
        params.beforeSeq = cursor.seq
    }
    const response = await http.get(
        `${apiUrl}/api/sessions/${encodeURIComponent(sessionId)}/messages`,
        {
            headers: authHeaders(jwt),
            params,
            timeout: 20_000,
            validateStatus: () => true
        }
    )
    if (response.status < 200 || response.status >= 300) {
        const detail = typeof response.data?.error === 'string'
            ? response.data.error
            : `HTTP ${response.status}`
        throw new PingPeerError('not_found', `failed to load messages for ${sessionId} (${detail})`)
    }
    const rows = Array.isArray(response.data?.messages) ? response.data.messages : []
    const page = isObject(response.data?.page) ? response.data.page : {}
    return {
        rows,
        nextBeforeAt: typeof page.nextBeforeAt === 'number' ? page.nextBeforeAt : null,
        nextBeforeSeq: typeof page.nextBeforeSeq === 'number' ? page.nextBeforeSeq : null
    }
}

/**
 * Collect up to `textLimit` extractable text messages, walking hub pages
 * backwards (newest first). Tool-call / noise rows are skipped and do not
 * count toward the limit. `olderBefore*` tracks the last consumed raw row so
 * a follow-up call resumes exactly where this one stopped.
 */
async function fetchSessionMessages(
    apiUrl: string,
    jwt: string,
    sessionId: string,
    textLimit: number,
    initialCursor: { at: number; seq: number } | null,
    http: AxiosInstance
): Promise<InspectMessagesPage> {
    const messages: InspectPeerMessage[] = []
    let cursor = initialCursor
    let olderBeforeAt: number | null = null
    let olderBeforeSeq: number | null = null

    while (messages.length < textLimit) {
        const page = await fetchInspectRawPage(apiUrl, jwt, sessionId, cursor, http)
        if (page.rows.length === 0) break
        let consumedAllRows = true
        for (const row of page.rows) {
            if (!isObject(row)) continue
            if (messages.length >= textLimit) {
                // Stopped mid-page: the remaining rows stay unread, so the
                // hub's nextBefore would skip them. Keep the cursor on the
                // last consumed row instead.
                consumedAllRows = false
                break
            }
            const snippet = extractInspectMessageSnippet(row.content)
            if (snippet) {
                messages.push({
                    ...snippet,
                    id: typeof row.id === 'string' ? row.id : snippet.id,
                    createdAt: typeof row.createdAt === 'number' ? row.createdAt : null
                })
            }
            if (typeof row.createdAt === 'number' && typeof row.seq === 'number') {
                olderBeforeAt = row.createdAt
                olderBeforeSeq = row.seq
            }
        }
        if (messages.length >= textLimit && !consumedAllRows) break
        // Page fully consumed: the hub cursor is authoritative, including
        // null once the start of the session is reached.
        if (page.nextBeforeSeq === null || page.nextBeforeAt === null) {
            olderBeforeAt = null
            olderBeforeSeq = null
            break
        }
        cursor = { at: page.nextBeforeAt, seq: page.nextBeforeSeq }
        olderBeforeAt = page.nextBeforeAt
        olderBeforeSeq = page.nextBeforeSeq
    }

    return { messages, olderBeforeAt, olderBeforeSeq }
}

/**
 * Resolve a peer by id/prefix and return metadata + recent text messages.
 * Reads newest-first; pass beforeAt/beforeSeq (from a previous result's
 * olderBeforeAt/olderBeforeSeq) to page further back through the history.
 * Read-only: never resumes inactive sessions (unlike `pingPeer`).
 */
export async function inspectPeer(options: InspectPeerOptions): Promise<InspectPeerResult> {
    const prefix = normalizeSessionIdPrefix(options.sessionIdPrefix ?? '')
    if (!prefix) {
        throw new PingPeerError('bad_args', 'session id prefix is required')
    }
    const messageLimit = clampInspectMessageLimit(options.messageLimit)
    const cursor = resolveInspectCursor(options.beforeAt, options.beforeSeq)

    const apiUrl = resolveApiUrl(options.apiUrl)
    const accessToken = resolveAccessToken(options.accessToken)
    const http = options.http ?? axios

    const jwt = await exchangeJwt(apiUrl, accessToken, http)
    const sessions = await listSessions(apiUrl, jwt, http)
    const matched = resolveSessionByPrefix(sessions, prefix)
    const live = await getSession(apiUrl, jwt, matched.id, http)
    const meta = live.metadata ?? matched.metadata ?? null
    const page = await fetchSessionMessages(apiUrl, jwt, matched.id, messageLimit, cursor, http)

    return {
        sessionId: matched.id,
        name: resolvePeerSessionLabel({ ...matched, metadata: meta ?? matched.metadata ?? null }),
        active: live.active,
        thinking: Boolean(live.thinking),
        flavor: typeof meta?.flavor === 'string' ? meta.flavor : null,
        path: typeof meta?.path === 'string' ? meta.path : null,
        lifecycleState: typeof meta?.lifecycleState === 'string' ? meta.lifecycleState : null,
        updatedAt: typeof live.updatedAt === 'number'
            ? live.updatedAt
            : typeof matched.updatedAt === 'number'
                ? matched.updatedAt
                : null,
        messages: page.messages,
        olderBeforeAt: page.olderBeforeAt,
        olderBeforeSeq: page.olderBeforeSeq
    }
}

/** Human/agent-readable report for MCP tool results and CLI stdout. */
export function formatInspectPeerReport(result: InspectPeerResult): string {
    const lines: string[] = [
        `sessionId: ${result.sessionId}`,
        `path: /sessions/${result.sessionId}`,
        `name: ${result.name}`,
        `flavor: ${result.flavor ?? '(unknown)'}`,
        `active: ${result.active}`,
        `thinking: ${result.thinking}`,
        `lifecycle: ${result.lifecycleState ?? '(none)'}`,
        `cwd: ${result.path ?? '(unknown)'}`,
        `updatedAt: ${result.updatedAt ?? '(unknown)'}`,
        `messages (text, newest-first page): ${result.messages.length}`
    ]
    if (result.messages.length === 0) {
        lines.push('(no extractable user/assistant text in this page)')
    } else {
        for (const message of result.messages) {
            const [first, ...rest] = message.text.split('\n')
            lines.push(`[${message.role}] ${first}`)
            for (const line of rest) {
                lines.push(`  ${line}`)
            }
        }
    }
    if (result.olderBeforeAt !== null && result.olderBeforeSeq !== null) {
        lines.push(
            `older page: available - call again with beforeAt=${result.olderBeforeAt}, beforeSeq=${result.olderBeforeSeq}`
        )
    } else {
        lines.push('older page: none (start of session reached)')
    }
    return lines.join('\n')
}

export type ArchivePeerOptions = {
    sessionId: string
    apiUrl?: string
    accessToken?: string
    http?: AxiosInstance
}

/** Stop an idle peer session after its task has been integrated. Never resume it. */
export async function archivePeer(options: ArchivePeerOptions): Promise<{ sessionId: string; alreadyArchived: boolean }> {
    const sessionId = normalizeSessionIdPrefix(options.sessionId ?? '')
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId)) {
        throw new PingPeerError('bad_args', 'archive-peer requires a full HAPI session UUID')
    }
    if (sessionId === process.env.HAPI_SESSION_ID) {
        throw new PingPeerError('bad_args', 'cannot archive the current HAPI session')
    }

    const apiUrl = resolveApiUrl(options.apiUrl)
    const accessToken = resolveAccessToken(options.accessToken)
    const http = options.http ?? axios
    const jwt = await exchangeJwt(apiUrl, accessToken, http)
    const matched = resolveSessionByPrefix(await listSessions(apiUrl, jwt, http), sessionId)
    const live = await getSession(apiUrl, jwt, matched.id, http)

    if (!live.active && live.metadata?.lifecycleState === 'archived') {
        return { sessionId, alreadyArchived: true }
    }
    if (!live.active) {
        throw new PingPeerError('archive_failed', `session ${sessionId} is inactive and cannot be archived`)
    }
    if (live.thinking !== false) {
        throw new PingPeerError('busy', `session ${sessionId} is busy or its idle state is unknown`)
    }

    const response = await http.post(
        `${apiUrl}/api/sessions/${encodeURIComponent(sessionId)}/archive`,
        {},
        {
            headers: authHeaders(jwt),
            timeout: 30_000,
            validateStatus: () => true
        }
    )
    if (response.status < 200 || response.status >= 300 || response.data?.ok !== true) {
        const detail = typeof response.data?.error === 'string'
            ? response.data.error
            : `HTTP ${response.status}`
        throw new PingPeerError('archive_failed', `failed to archive session ${sessionId} (${detail})`)
    }
    return { sessionId, alreadyArchived: response.data.alreadyArchived === true }
}
