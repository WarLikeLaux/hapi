import { useCallback, useEffect, useState } from 'react'

const EXTERNAL_EDITOR_BASE_URL_STORAGE_KEY = 'hapi-external-editor-base-url'

// Personal opt-in: base URL of a local editor that understands the
// `?folder=<abs>&payload=[["openFile","vscode-remote://<host><abs>"]]` scheme
// (e.g. a code-server behind https://code.local). Empty = disabled, chat file
// links keep opening the built-in HAPI file viewer.
const sameTabListeners = new Set<(value: string) => void>()

function isBrowser(): boolean {
    return typeof window !== 'undefined' && typeof document !== 'undefined'
}

function safeGetItem(key: string): string | null {
    if (!isBrowser()) return null
    try {
        return localStorage.getItem(key)
    } catch {
        return null
    }
}

function safeSetItem(key: string, value: string): void {
    if (!isBrowser()) return
    try {
        localStorage.setItem(key, value)
    } catch {
        // Ignore storage errors
    }
}

function safeRemoveItem(key: string): void {
    if (!isBrowser()) return
    try {
        localStorage.removeItem(key)
    } catch {
        // Ignore storage errors
    }
}

/**
 * Normalise a user-entered editor base URL. Returns the origin + pathname
 * without trailing slash, or null when the value is empty/invalid.
 * Only http(s) URLs are accepted.
 */
export function normalizeExternalEditorBaseUrl(raw: string): string | null {
    const trimmed = raw.trim().replace(/\/+$/, '')
    if (!trimmed) return null
    let parsed: URL
    try {
        parsed = new URL(trimmed)
    } catch {
        return null
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    return `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`
}

export function getInitialExternalEditorBaseUrl(): string {
    return safeGetItem(EXTERNAL_EDITOR_BASE_URL_STORAGE_KEY) ?? ''
}

export function useExternalEditorBaseUrl(): {
    externalEditorBaseUrl: string
    setExternalEditorBaseUrl: (value: string) => void
} {
    const [externalEditorBaseUrl, setExternalEditorBaseUrlState] = useState<string>(getInitialExternalEditorBaseUrl)

    useEffect(() => {
        if (!isBrowser()) return
        const onStorage = (event: StorageEvent) => {
            if (event.key !== EXTERNAL_EDITOR_BASE_URL_STORAGE_KEY) return
            setExternalEditorBaseUrlState(event.newValue ?? '')
        }
        sameTabListeners.add(setExternalEditorBaseUrlState)
        window.addEventListener('storage', onStorage)
        return () => {
            sameTabListeners.delete(setExternalEditorBaseUrlState)
            window.removeEventListener('storage', onStorage)
        }
    }, [])

    const setExternalEditorBaseUrl = useCallback((value: string) => {
        const normalized = normalizeExternalEditorBaseUrl(value) ?? ''
        for (const listener of sameTabListeners) {
            listener(normalized)
        }
        if (!normalized) {
            safeRemoveItem(EXTERNAL_EDITOR_BASE_URL_STORAGE_KEY)
        } else {
            safeSetItem(EXTERNAL_EDITOR_BASE_URL_STORAGE_KEY, normalized)
        }
    }, [])

    return { externalEditorBaseUrl, setExternalEditorBaseUrl }
}
