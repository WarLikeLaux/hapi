# Session list

HAPI's Web session list combines live session state, project grouping, search,
and local display filters. The list is designed to keep sessions that need
attention easy to find while still allowing older sessions to be searched.

## Ordering and grouping

This fork keeps separate clocks for different parts of the list:

- Working sessions follow the newest user input, so streaming output does not reshuffle work in progress.
- Active and Recent sessions follow agent activity. New empty sessions stay at the top of Active.
- Global pins, project pins, parked sessions and chat groups keep their own sections and ordering.
- Project and machine groups use the fork's user-activity order. Search can rank matching rows by relevance.

The Hub persists original user-message timestamps. Historical imports, duplicate messages and delivery acknowledgements must not make old input look new. `activeAt` tracks the CLI connection, while `lastAgentMessageAt` supplies the agent-activity ordering clock. Unread state uses shared content/read revisions, synchronized between desktop Web and phone PWA. Generic metadata and keepalive updates do not create unread messages. Muted sessions do not attract unread attention. See [read state](../api/client-contract/read-state.md) for acknowledgements and upgrade behavior.

The default REST list has its own deterministic user-input ordering. The Web client applies the section rules above after loading it. See [REST sessions](../api/client-contract/rest.md#sessions--list--detail) and [SSE keepalives](../api/client-contract/sse.md#keep-alive-noise) for the wire contract.

## Text search

The search field on the Web session list searches session metadata, including:

- the displayed title (name, summary, path, or ID fallback);
- worktree labels and paths;
- summary text;
- agent flavor and machine label; and
- the session ID.

Plain-text matching is case-insensitive and supports partial substrings. A
multi-word query uses AND semantics: every term must match at least one
searchable field. Queries containing `*` or `?` use wildcard matching, where
`*` matches any sequence and `?` matches one character.

Search results are ranked by relevance rather than by date alone. Title and
worktree matches are more prominent than summary, machine, path, or ID-only
matches; token-boundary matches and exact/contiguous title phrases receive
additional preference. When relevance is tied, the fork's normal section order breaks the tie. This means an older session with a distinctive title can
appear above a newer session that only matches a common path segment.

Search preserves the session-list structure: pinned rows remain contiguous and
project groups remain visible. Matching project groups open automatically, but
the preview limit still applies within an open group. Search does not apply a
relevance cutoff; use the group's batch reveal controls to show additional
matching rows.

## Filters and display settings

- **Date range**, inside expanded search, filters by the local calendar date of `updatedAt`. The end date includes the whole local day.
- **Machine** filters can be applied when more than one machine is present.
  The selection is remembered locally in the browser and falls back to All
  when that machine is no longer available.
- **Active sessions only** hides inactive sessions but keeps the selected
  session visible.
- **Session preview limit** controls how many rows are initially visible within
  each project group. Sessions with pending requests and the selected session
  can remain visible; a project can reveal more rows in batches.
- **Session-list status** controls whether rows show the standard or detailed
  attention/status presentation.

Empty, inactive session stubs without conversation, an agent identity, or an
explicit title signal are not shown in the normal sidebar. Duplicate rows
representing the same underlying agent session are collapsed, with the live,
selected, pinned, or most recent row preferred as appropriate.

## Other Web session pickers

The other Web surfaces intentionally use related but different policies:

### Share-target picker

The `/share` picker snapshots the session list when it opens so live SSE
updates do not reshuffle the rows under the user's finger.

- With no query or date range, it shows recent active sessions, sorted by
  `updatedAt` and capped by the session preview limit.
- With a text query or date range, it searches all matching sessions,
  including inactive sessions, and keeps `updatedAt` descending order.
- It reuses the session metadata matching fields, but it does not apply the
  main sidebar's relevance ranking.

### `@` session suggestions

Composer `@` suggestions only include sessions with conversation content.
With an empty query they prefer active and recent sessions; after typing, they
use a separate title/ID/active/recency ranking. Names, directories, and
machine labels affect matching, but an empty stub is never a mention target.
