import { useCallback, useEffect, useState } from 'react'

export type FreshChatsWindowPreset = 'off' | '1h' | '2h' | '6h' | '12h' | '24h'

export const DEFAULT_FRESH_CHATS_WINDOW: FreshChatsWindowPreset = '2h'

export const FRESH_CHATS_WINDOW_PRESETS: ReadonlyArray<FreshChatsWindowPreset> = [
    'off',
    '1h',
    '2h',
    '6h',
    '12h',
    '24h',
]

export function getFreshChatsWindowOptions(): ReadonlyArray<{ value: FreshChatsWindowPreset; labelKey: string }> {
    return FRESH_CHATS_WINDOW_PRESETS.map((value) => ({
        value,
        labelKey: `settings.display.freshChats.${value}`,
    }))
}

const WINDOW_MS: Record<Exclude<FreshChatsWindowPreset, 'off'>, number> = {
    '1h': 60 * 60_000,
    '2h': 2 * 60 * 60_000,
    '6h': 6 * 60 * 60_000,
    '12h': 12 * 60 * 60_000,
    '24h': 24 * 60 * 60_000,
}

/** Grace window in ms, or null when fresh chats are disabled. */
export function getFreshChatsWindowMs(preset: FreshChatsWindowPreset): number | null {
    return preset === 'off' ? null : WINDOW_MS[preset]
}

function getFreshChatsWindowStorageKey(): string {
    return 'hapi-fresh-chats-window'
}

function isBrowser(): boolean {
    return typeof window !== 'undefined' && typeof document !== 'undefined'
}

function safeGetItem(key: string): string | null {
    if (!isBrowser()) {
        return null
    }
    try {
        return localStorage.getItem(key)
    } catch {
        return null
    }
}

function safeSetItem(key: string, value: string): void {
    if (!isBrowser()) {
        return
    }
    try {
        localStorage.setItem(key, value)
    } catch {
        // Ignore storage errors
    }
}

function safeRemoveItem(key: string): void {
    if (!isBrowser()) {
        return
    }
    try {
        localStorage.removeItem(key)
    } catch {
        // Ignore storage errors
    }
}

function parseFreshChatsWindow(raw: string | null): FreshChatsWindowPreset {
    return FRESH_CHATS_WINDOW_PRESETS.includes(raw as FreshChatsWindowPreset)
        ? raw as FreshChatsWindowPreset
        : DEFAULT_FRESH_CHATS_WINDOW
}

export function getInitialFreshChatsWindow(): FreshChatsWindowPreset {
    return parseFreshChatsWindow(safeGetItem(getFreshChatsWindowStorageKey()))
}

export function useFreshChatsWindow(): {
    freshChatsWindow: FreshChatsWindowPreset
    setFreshChatsWindow: (preset: FreshChatsWindowPreset) => void
} {
    const [freshChatsWindow, setFreshChatsWindowState] = useState<FreshChatsWindowPreset>(getInitialFreshChatsWindow)

    useEffect(() => {
        if (!isBrowser()) {
            return
        }

        const onStorage = (event: StorageEvent) => {
            if (event.key !== getFreshChatsWindowStorageKey()) {
                return
            }
            setFreshChatsWindowState(parseFreshChatsWindow(event.newValue))
        }

        window.addEventListener('storage', onStorage)
        return () => window.removeEventListener('storage', onStorage)
    }, [])

    const setFreshChatsWindow = useCallback((preset: FreshChatsWindowPreset) => {
        setFreshChatsWindowState(preset)

        if (preset === DEFAULT_FRESH_CHATS_WINDOW) {
            safeRemoveItem(getFreshChatsWindowStorageKey())
        } else {
            safeSetItem(getFreshChatsWindowStorageKey(), preset)
        }
    }, [])

    return { freshChatsWindow, setFreshChatsWindow }
}
