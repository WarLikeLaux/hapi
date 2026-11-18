---
description: "Find and organize HAPI sessions: presence badges, project grouping, search by details or message text, sort and filter, unread handling and row actions."
---

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

The search field has two scopes. The icon at its left edge switches between
them.

**Session details** (the default) searches session metadata, including:

- the displayed title (name, summary, path, or ID fallback);
- worktree labels and paths;
- summary text;
- agent flavor and machine label; and
- the session ID.

A **Default / Exclude** menu beside the field applies to this scope:
**Exclude** inverts the match and shows only sessions that do *not* match the
query.

**Message text** searches the messages inside every session (at least 2
characters). Matching sessions are listed with a snippet of the matching
message; opening a result jumps to that message. Very long messages are
truncated for indexing, so the list notes when results may be incomplete. The
status and **Unread only** filters still apply. Inside a chat, the same
message-text search is available for the current session.

In the session-details scope, plain-text matching is case-insensitive and supports partial substrings. A
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
  each project group. Unread sessions, sessions with pending requests, and the
  selected session can remain visible; a project can reveal more rows in
  batches.
- **Session list status hints** chooses Basic (runtime state) or Extended
  (also permission, input, background-task, new-activity and scheduled-message
  hints).

## Row and group actions

- **Session rows.** Hover a row (desktop) to archive it or unpin it directly.
  The row menu also offers rename, global or project pin, and **Open in
  separate window**.
- **Status indicators.** The agent icon carries the presence badge. A spinner
  beside the title combines running activity with unread state; an unread
  session at rest shows a dot.
- **Titles.** Agents name sessions automatically and may update the title as
  work progresses. In the **Rename** dialog, the padlock locks a title so
  agent activity cannot change it; tap it again to unlock.
- **Project groups.** Right-click (or long-press) a project header to copy its
  path, start a new session in that directory, or archive all of its sessions.

Empty, inactive session stubs without conversation, an agent identity, or an
explicit title signal are not shown in the normal sidebar. Duplicate rows
representing the same underlying agent session are collapsed, with the live,
selected, pinned, or most recent row preferred as appropriate.

## Other Web session pickers

The other Web surfaces intentionally use related but different policies:

### Share-target picker

The `/share` picker snapshots the session list when it opens so live SSE
updates do not reshuffle the rows under the user's finger.

- With no query, it shows recent active sessions, sorted by `updatedAt` and
  capped by the session preview limit.
- With a text query, it searches all matching sessions,
  including inactive sessions, and keeps `updatedAt` descending order.
- It reuses the session metadata matching fields, but it does not apply the
  main sidebar's relevance ranking.

### `@` session suggestions

Composer `@` suggestions only include sessions with conversation content.
Active sessions appear first, followed by an inactive section that can be
collapsed or expanded. The browser remembers that choice. Each group shows up
to 20 matches, ordered by relevance and recency; names, directories, and
machine labels affect matching. Empty stubs are never mention targets, and
collapsing inactive sessions does not hide file suggestions.
