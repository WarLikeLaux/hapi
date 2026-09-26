import { useEffect, useRef, useState } from 'react'
import { useTranslation } from '@/lib/use-translation'
import type { ApiClient } from '@/api/client'
import type { MessageSearchHit } from '@/types/api'
import type { MessageSearchState } from '@/hooks/queries/useMessageSearch'
import { formatRelativeTime } from '@/lib/relativeTime'
import { Spinner } from '@/components/Spinner'

const PREVIEW_HITS = 3
const SESSION_FETCH_LIMIT = 100

type SessionExpansion = {
    hits: MessageSearchHit[]
    hasMore: boolean
    phase: 'loading' | 'idle' | 'loadingMore' | 'error'
}

/**
 * Chat-content search results on the messages tab of the session-list search:
 * hits grouped by session (match count descending), each chat showing its
 * newest hits with the rest behind an inline expander that pages through older
 * matches via the keyset cursor. The query fetch itself lives in the parent
 * (SessionList) so the tab badge can show the total; selecting a hit opens its
 * session. In-chat scroll-to-message stays a follow-up.
 */
export function MessageSearchResults(props: {
    api: ApiClient | null
    query: string
    state: MessageSearchState
    onSelect: (sessionId: string) => void
    sessionTitles: ReadonlyMap<string, string>
}) {
    const { t } = useTranslation()
    const { response, isLoading, error } = props.state
    const [expansions, setExpansions] = useState<Record<string, SessionExpansion>>({})
    const abortsRef = useRef(new Map<string, AbortController>())

    // A new query invalidates every expanded chat; abort its in-flight pages.
    useEffect(() => {
        setExpansions({})
        return () => {
            for (const controller of abortsRef.current.values()) controller.abort()
            abortsRef.current.clear()
        }
    }, [props.query])

    if (props.query.trim().length < 2 || (!response && !isLoading && !error)) {
        return null
    }

    const sessions = response?.sessions ?? []
    const previews = new Map<string, MessageSearchHit[]>()
    for (const hit of response?.hits ?? []) {
        const list = previews.get(hit.sessionId)
        if (list) {
            list.push(hit)
        } else {
            previews.set(hit.sessionId, [hit])
        }
    }

    const collapseSession = (sessionId: string) => {
        abortsRef.current.get(sessionId)?.abort()
        abortsRef.current.delete(sessionId)
        setExpansions((previous) => {
            const next = { ...previous }
            delete next[sessionId]
            return next
        })
    }

    const fetchSessionPage = (sessionId: string, cursor?: { beforeCreatedAt: number; beforeSeq: number }) => {
        if (!props.api) return
        const previousController = abortsRef.current.get(sessionId)
        previousController?.abort()
        const controller = new AbortController()
        abortsRef.current.set(sessionId, controller)
        props.api.searchMessages(props.query.trim(), {
            sessionId,
            limit: SESSION_FETCH_LIMIT,
            beforeCreatedAt: cursor?.beforeCreatedAt,
            beforeSeq: cursor?.beforeSeq,
            signal: controller.signal
        })
            .then((page) => {
                if (controller.signal.aborted) return
                setExpansions((previous) => {
                    const current = previous[sessionId]
                    if (!current) return previous
                    return {
                        ...previous,
                        [sessionId]: { hits: [...current.hits, ...page.hits], hasMore: page.hasMore, phase: 'idle' }
                    }
                })
            })
            .catch(() => {
                if (controller.signal.aborted) return
                setExpansions((previous) => {
                    const current = previous[sessionId]
                    if (!current) return previous
                    return { ...previous, [sessionId]: { ...current, phase: 'error' } }
                })
            })
    }

    const expandSession = (sessionId: string) => {
        setExpansions((previous) => ({ ...previous, [sessionId]: { hits: [], hasMore: false, phase: 'loading' } }))
        fetchSessionPage(sessionId)
    }

    const toggleSession = (sessionId: string) => {
        if (expansions[sessionId]) {
            collapseSession(sessionId)
        } else {
            expandSession(sessionId)
        }
    }

    const loadMoreSession = (sessionId: string) => {
        const expansion = expansions[sessionId]
        if (!expansion || expansion.phase !== 'idle') return
        const last = expansion.hits[expansion.hits.length - 1]
        if (!last) return
        setExpansions((previous) => ({
            ...previous,
            [sessionId]: { ...previous[sessionId]!, phase: 'loadingMore' }
        }))
        fetchSessionPage(sessionId, { beforeCreatedAt: last.createdAt, beforeSeq: last.seq })
    }

    return (
        <div data-testid="message-search-results">
            <div className="flex min-w-0 w-full select-none items-center gap-2 rounded-lg py-1.5 pl-2 pr-2">
                <span className="min-w-0 truncate text-sm font-medium">
                    {t('sessions.messageSearch.title')}
                </span>
                <span className="min-w-0 flex-1" aria-hidden="true" />
                {isLoading ? (
                    <Spinner size="sm" label={null} className="text-[var(--app-hint)]" />
                ) : (
                    <span className="shrink-0 text-[11px] tabular-nums text-[var(--app-hint)]">
                        ({response?.total ?? 0})
                    </span>
                )}
            </div>
            {error ? (
                <div className="px-4 py-3 text-sm text-[var(--app-hint)]">
                    {t('sessions.messageSearch.failed')}
                </div>
            ) : null}
            {response && sessions.length === 0 ? (
                <div className="px-4 py-3 text-sm text-[var(--app-hint)]">
                    {t('sessions.messageSearch.empty')}
                </div>
            ) : null}
            <div className="flex flex-col gap-1 ml-3 pl-1 pb-1">
                {sessions.map((session) => {
                    const title = props.sessionTitles.get(session.sessionId) ?? session.sessionId
                    const expansion = expansions[session.sessionId]
                    const hits = expansion ? expansion.hits : (previews.get(session.sessionId) ?? []).slice(0, PREVIEW_HITS)
                    const hiddenCount = session.count - hits.length
                    return (
                        <div key={session.sessionId} className="flex flex-col" data-testid={`message-search-session-${session.sessionId}`}>
                            <button
                                type="button"
                                onClick={() => toggleSession(session.sessionId)}
                                className="flex min-w-0 w-full select-none items-center gap-2 rounded-lg py-1 pl-2 pr-2 text-left transition-colors hover:bg-[var(--app-secondary-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)]"
                            >
                                <span className="min-w-0 truncate text-xs font-medium">
                                    {title}
                                </span>
                                <span className="min-w-0 flex-1" aria-hidden="true" />
                                <span className="shrink-0 text-[11px] tabular-nums text-[var(--app-hint)]">
                                    ({session.count})
                                </span>
                            </button>
                            <div className="flex flex-col gap-0.5">
                                {hits.map((hit) => (
                                    <MessageSearchHitRow
                                        key={hit.messageId}
                                        hit={hit}
                                        onSelect={props.onSelect}
                                    />
                                ))}
                            </div>
                            {expansion === undefined && hiddenCount > 0 ? (
                                <button
                                    type="button"
                                    onClick={() => expandSession(session.sessionId)}
                                    className="rounded-lg px-2 py-1 text-left text-xs text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)]"
                                >
                                    {hits.length > 0
                                        ? t('sessions.messageSearch.moreInSession', { n: hiddenCount })
                                        : t('sessions.messageSearch.showInSession', { n: hiddenCount })}
                                </button>
                            ) : null}
                            {expansion?.phase === 'loading' || expansion?.phase === 'loadingMore' ? (
                                <div className="px-2 py-1">
                                    <Spinner size="sm" label={null} className="text-[var(--app-hint)]" />
                                </div>
                            ) : null}
                            {expansion?.phase === 'error' ? (
                                <div className="px-2 py-1 text-xs text-[var(--app-hint)]">
                                    {t('sessions.messageSearch.failed')}
                                </div>
                            ) : null}
                            {expansion?.phase === 'idle' && expansion.hasMore ? (
                                <button
                                    type="button"
                                    onClick={() => loadMoreSession(session.sessionId)}
                                    className="rounded-lg px-2 py-1 text-left text-xs text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)]"
                                >
                                    {t('sessions.messageSearch.loadMore')}
                                </button>
                            ) : null}
                        </div>
                    )
                })}
            </div>
        </div>
    )
}

function MessageSearchHitRow(props: {
    hit: MessageSearchHit
    onSelect: (sessionId: string) => void
}) {
    const { t } = useTranslation()
    const hit = props.hit

    const before = hit.snippet.slice(0, hit.matchStart)
    const match = hit.snippet.slice(hit.matchStart, hit.matchStart + hit.matchLength)
    const after = hit.snippet.slice(hit.matchStart + hit.matchLength)
    const time = formatRelativeTime(hit.createdAt, t)

    return (
        <button
            type="button"
            onClick={() => props.onSelect(hit.sessionId)}
            className="flex w-full min-w-0 flex-col gap-0.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-[var(--app-secondary-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)]"
        >
            <span className="line-clamp-2 text-sm leading-snug">
                {before}
                <mark className="rounded bg-[var(--app-subtle-bg)] px-0.5 text-[var(--app-fg)]">{match}</mark>
                {after}
            </span>
            <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-[var(--app-hint)]">
                <span className="shrink-0 rounded border border-[var(--app-border)] px-1">
                    {hit.role === 'user'
                        ? t('sessions.messageSearch.roleUser')
                        : t('sessions.messageSearch.roleAgent')}
                </span>
                {time ? <span className="ml-auto shrink-0 tabular-nums">{time}</span> : null}
            </span>
        </button>
    )
}
