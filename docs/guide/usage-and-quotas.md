---
description: "Track agent working time with hapi usage, token usage per session, and provider quotas and rate limits."
---

# Usage and quotas

HAPI answers three different questions about how much your agents are doing:

| Question | Where | Scope |
|----------|-------|-------|
| When were agents working, and for how long? | `hapi usage` (CLI) | Your namespace |
| How many tokens did they process? | **Settings → Usage** | Hub owner only |
| How much of my plan's rate limit is left? | **Settings → Limits** | Your namespace |

## Agent activity: `hapi usage`

The hub records each agent **turn** — from the moment a session starts thinking until it stops — in its database. Turns survive hub restarts: on startup the hub closes turns that the previous process left open at the session's newest message, and if the agent keeps thinking within 10 minutes of the restart, the same turn continues.

`hapi usage` reads those turns back across every machine connected to the hub:

```bash
hapi usage                                    # last 24 hours
hapi usage --since 7d
hapi usage --since 2026-10-01 --until 2026-10-08
hapi usage --json                             # machine-readable, schema hapi.activity.v1
```

`--since` and `--until` accept relative durations (`30m`, `24h`, `7d`), an ISO date, or epoch milliseconds. A window can be at most 31 days.

The summary lists sessions sorted by time worked, with title, agent, machine (`this machine` for the local one), number of turns, and `(working now)` for a turn still in progress:

```
Agents worked 3h 12m across 4 sessions:
     1h 40m  refactor auth · claude · this machine · 6 turns
     ...
```

Only the part of each turn inside the window is counted, and time spent waiting on a permission prompt or a question is subtracted from it.

`--json` prints the full report (each session's turns and waits) for other tools such as time trackers. Errors go to stderr so stdout stays parseable.

| Exit code | Meaning |
|-----------|---------|
| `2` | Bad arguments |
| `3` | Not signed in, or the hub refused the token |
| `4` | Hub too old to answer |
| `1` | Any other error |

`hapi usage` authenticates like the other CLI commands — `HAPI_API_URL` / `CLI_API_TOKEN`, or the settings saved by `hapi auth login`. It reports the namespace of that token; it is not restricted to the hub owner. See the [CLI reference](./cli-reference.md) for shared options.

## Token usage dashboard

**Settings → Usage** in the web app shows tokens processed while agents ran under HAPI, for the last 7 days, 30 days, or all time:

- Totals: processed tokens, non-cached tokens, input, output, cache read, cache creation, cache hit rate, and request count
- A daily trend, plus breakdowns by agent and by model
- The number of sessions with usage

Token usage from transcripts imported from earlier local history is excluded, and costs are not shown.

::: info Hub owner only
The token dashboard is only available to the hub owner (the `default` namespace). Other namespaces get an explanatory message instead. See [Namespaces](./namespace.md).
:::

## Account limits

**Settings → Limits** shows snapshots collected by online runners for Codex, Antigravity, Cursor, Z.ai, and OpenCode Go. A runner reports every five minutes. The page shows used and remaining capacity when the provider supplies it, along with reset times.

Use the Claude Code refresh control on the same page to fetch the current plan windows on demand. The runner reads them from the signed-in Claude Code account. API-key and custom-endpoint sessions may have no plan windows.

To read the token totals from a terminal or another agent, use `hapi get usage` or the `get_usage` MCP tool.

## Related

- [Session list](./session-list.md)
- [Configuration](./configuration.md)
- [Authentication](./installation.md)
