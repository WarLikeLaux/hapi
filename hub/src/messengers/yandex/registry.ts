/**
 * Registry HTTP transport of the personal Yandex Messenger protocol.
 *
 * A registry call is a multipart POST with a single `request` field holding JSON
 * `{method, params}`; authorization is the session Cookie header alone for reads.
 * Mutations (`request_user`, join/leave) additionally require `X-CSRF-TOKEN`.
 * Responses are wrapped as `{status, data}` — except `csrf-token`, which returns a
 * bare `{token}` and therefore bypasses the envelope handling.
 */

const API_URL = 'https://yandex.ru/messenger/api/registry/api/'
const CSRF_TOKEN_URL = 'https://yandex.ru/messenger/api/registry/csrf-token/'

/** Registry error codes meaning the cookie was rejected or expired. */
const COOKIE_ERROR_CODES = new Set(['invalid_cookies', 'not_authorized', 'no_credentials', 'cookie_auth_failed'])
const BAD_CSRF_TOKEN_CODE = 'bad_csrf_token'

export class CookieRejectedError extends Error {
    constructor(readonly method: string, readonly code: string) {
        super(`registry ${method} rejected cookies: ${code}`)
        this.name = 'CookieRejectedError'
    }
}

export class RegistryError extends Error {
    constructor(readonly method: string, readonly code: string, readonly text: string | undefined) {
        const details = text ? `: ${text}` : ''
        super(`registry ${method} returned error ${code}${details}`)
        this.name = 'RegistryError'
    }
}

function registryHeaders(cookieHeader: string): Record<string, string> {
    return {
        Cookie: cookieHeader,
        Accept: 'application/json',
        Referer: 'https://yandex.ru/chat'
    }
}

export interface RegistryIdentity {
    guid: string
    uid?: string
    displayName?: string
}

export interface RegistryUser {
    guid: string
    avatarId: string | null
    displayName: string | null
}

/** Cookie-bound registry client: caches the CSRF token, retries once on `bad_csrf_token`. */
export class RegistryClient {
    private csrfToken: string | undefined

    constructor(private readonly cookieHeader: string) {}

    private async fetchCsrfToken(): Promise<string> {
        const response = await fetch(CSRF_TOKEN_URL, {
            method: 'POST',
            headers: registryHeaders(this.cookieHeader)
        })
        if (response.status === 401 || response.status === 403) {
            throw new CookieRejectedError('csrf-token', `HTTP ${response.status}`)
        }
        if (!response.ok) throw new Error(`csrf-token returned HTTP ${response.status}`)
        const payload = await response.json() as { token?: unknown }
        if (typeof payload.token !== 'string' || payload.token.length === 0) {
            throw new Error('csrf-token did not return a token field')
        }
        return payload.token
    }

    private async token(forceRefresh: boolean): Promise<string> {
        if (this.csrfToken === undefined || forceRefresh) {
            this.csrfToken = await this.fetchCsrfToken()
        }
        return this.csrfToken
    }

    /**
     * `request_user` resolves the account identity from cookies. Requires CSRF.
     * Returns guid + numeric uid for a logged-in personal account.
     */
    async requestUser(): Promise<RegistryIdentity> {
        const payload = await this.enveloped('request_user', { bind_phone_number: false }, true) as {
            user?: { guid?: unknown; uid?: unknown; display_name?: unknown }
        }
        const user = payload?.user
        if (!user || typeof user.guid !== 'string') {
            throw new RegistryError('request_user', 'no_guid', 'response did not include a user guid')
        }
        return {
            guid: user.guid,
            ...(typeof user.uid === 'string' || typeof user.uid === 'number' ? { uid: String(user.uid) } : {}),
            ...(typeof user.display_name === 'string' && user.display_name ? { displayName: user.display_name } : {})
        }
    }

    /**
     * Batch fetch of Yandex user records by guid. Used as a fallback when the
     * binary WS `history` payload does not carry `PartnerInfo.AvatarId` for direct
     * chats. Read-only — no CSRF required.
     *
     * The method name is not part of the public API surface; if `get_users` is
     * rejected as `unknown_method`, switch to `request_users` (and vice versa).
     * The caller already swallows `RegistryError` so a missing method is a soft miss.
     */
    async requestUsers(guids: string[]): Promise<RegistryUser[]> {
        if (guids.length === 0) return []
        type Payload = { users?: Array<{ guid?: unknown; avatar_id?: unknown; display_name?: unknown }> }
        const payload = await this.call<Payload>('get_users', { guids })
        const rows = Array.isArray(payload.users) ? payload.users : []
        const out: RegistryUser[] = []
        for (const row of rows) {
            if (!row || typeof row.guid !== 'string') continue
            out.push({
                guid: row.guid,
                avatarId: typeof row.avatar_id === 'string' && row.avatar_id.length > 0 ? row.avatar_id : null,
                displayName: typeof row.display_name === 'string' && row.display_name.length > 0 ? row.display_name : null
            })
        }
        return out
    }

    /** Calls a registry method and unwraps `data`. Read methods need no CSRF. */
    async call<T>(method: string, params: Record<string, unknown> = {}, options: { csrf?: boolean } = {}): Promise<T> {
        try {
            return await this.attempt<T>(method, params, options.csrf === true, false)
        } catch (error) {
            if (options.csrf === true && error instanceof RegistryError && error.code === BAD_CSRF_TOKEN_CODE) {
                return this.attempt<T>(method, params, true, true)
            }
            throw error
        }
    }

    private async attempt<T>(
        method: string,
        params: Record<string, unknown>,
        csrf: boolean,
        forceCsrfRefresh: boolean
    ): Promise<T> {
        const headers = registryHeaders(this.cookieHeader)
        if (csrf) headers['X-CSRF-TOKEN'] = await this.token(forceCsrfRefresh)
        const form = new FormData()
        form.append('request', JSON.stringify({ method, params }))
        const response = await fetch(API_URL, { method: 'POST', body: form, headers })
        if (response.status === 401) throw new CookieRejectedError(method, 'HTTP 401')
        const envelope = await response.json() as { status?: unknown; data?: unknown }
        if (envelope.status !== 'ok') {
            const data = (envelope.data ?? {}) as { code?: unknown; text?: unknown }
            const code = typeof data.code === 'string' ? data.code : 'unknown'
            if (COOKIE_ERROR_CODES.has(code)) throw new CookieRejectedError(method, code)
            throw new RegistryError(method, code, typeof data.text === 'string' ? data.text : undefined)
        }
        return envelope.data as T
    }

    private async enveloped(method: string, params: Record<string, unknown>, csrf: boolean): Promise<unknown> {
        return this.call(method, params, { csrf })
    }
}

/* ---------- timestamps ---------- */

/** Parses a microsecond mark (string/number) into BigInt; throws when the mark is absent. */
export function parseMicros(value: unknown): bigint {
    if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) return BigInt(value.trim())
    if (typeof value === 'number' && Number.isFinite(value)) return BigInt(Math.trunc(value))
    throw new RangeError(`not a microsecond mark: ${String(value)}`)
}

/** Microseconds -> epoch milliseconds (Number is precise for dates until year ~2255). */
export function microsToEpochMs(micros: bigint): number {
    return Number(micros / 1000n)
}

/**
 * Timestamp of a targeted message on the wire: pushed through Number with a 2^53 guard.
 * A string here instead of a number makes the backend answer BACKEND_CALL_ERROR.
 */
export function toWireTimestamp(micros: bigint): number {
    if (micros > 9007199254740991n) throw new RangeError('timestamp exceeds 2^53')
    return Number(micros)
}
