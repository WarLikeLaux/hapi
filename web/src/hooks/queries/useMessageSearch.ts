import { useEffect, useRef, useState } from 'react'
import type { ApiClient } from '@/api/client'
import type { MessageSearchResponse } from '@/types/api'

export type MessageSearchState = {
    response: MessageSearchResponse | null
    isLoading: boolean
    error: string | null
}

const DEBOUNCE_MS = 300
const MIN_QUERY_LENGTH = 2
const HIT_LIMIT = 30

/**
 * Server-side chat search over message content (user prompts + agent final
 * replies). Debounced and abortable; the previous response stays visible
 * while a new query is in flight so the section does not flicker per keystroke.
 */
export function useMessageSearch(api: ApiClient | null, query: string): MessageSearchState {
    const [state, setState] = useState<MessageSearchState>({ response: null, isLoading: false, error: null })
    const inFlightRef = useRef<AbortController | null>(null)

    const normalized = query.trim()

    useEffect(() => {
        inFlightRef.current?.abort()
        inFlightRef.current = null

        if (!api || normalized.length < MIN_QUERY_LENGTH) {
            setState({ response: null, isLoading: false, error: null })
            return
        }

        setState((previous) => ({ ...previous, isLoading: true, error: null }))

        const controller = new AbortController()
        inFlightRef.current = controller
        const timer = setTimeout(() => {
            api.searchMessages(normalized, { limit: HIT_LIMIT, signal: controller.signal })
                .then((response) => {
                    if (controller.signal.aborted) return
                    setState({ response, isLoading: false, error: null })
                })
                .catch((error: unknown) => {
                    if (controller.signal.aborted) return
                    setState({
                        response: null,
                        isLoading: false,
                        error: error instanceof Error ? error.message : String(error)
                    })
                })
        }, DEBOUNCE_MS)

        return () => {
            clearTimeout(timer)
            controller.abort()
            if (inFlightRef.current === controller) inFlightRef.current = null
        }
    }, [api, normalized])

    return state
}
