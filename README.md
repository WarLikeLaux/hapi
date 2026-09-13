[English](README.md) · [Русский](README-ru.md)

# HAPI custom fork

This is a maintained downstream fork of [HAPI](https://github.com/tiann/hapi) for a local-first Codex workflow shared between a desktop terminal and a phone. It keeps the upstream agent, Hub, Web/PWA, native-client, and Telegram architecture while adapting session navigation, project launching, notifications, and optional TermDeck handoff.

For the complete product overview, supported agents, and architecture, read the **[canonical upstream README](https://github.com/tiann/hapi#readme)**. This page documents only the differences and operational rules of this fork.

## What this fork changes

| Area | Fork behavior | Practical effect |
| --- | --- | --- |
| Session navigation | Separate Working, Active, and Recent sections; stable activity-based ordering; unread state; project/global pins; inactive-session filtering; and project-wide HAPI session cleanup that retains local agent transcripts. | The sessions that need attention stay visible without old sessions overwhelming the list. |
| Projects and new sessions | Searchable, sortable, pinnable workspace roots, manual folder selection, Codex first in the picker, and the first configured workspace root as the initial directory. | A runner scoped to a multi-project directory can launch Codex in any allowed project without source-code path constants. |
| Codex defaults and lifecycle | New Codex sessions initially use YOLO mode; explicit later choices are remembered. Stop, reopen, restart, and Codex history sync preserve clearer lifecycle and activity timestamps. | Starting work is faster, and switching between HAPI and a local Codex session is less disruptive. **YOLO bypasses approvals and sandboxing; change it before launch when that is not acceptable.** |
| Chat and mobile UI | Intermediate reasoning and tool activity are grouped behind one `Show work` action. Mobile Enter inserts a newline, the send control is touch-friendly, and stale PWA/SSE state is repaired more aggressively. | The transcript stays compact and phone input behaves like a messaging app. |
| Telegram | Notifications link directly to the session and are suppressed only while that exact chat is visibly open. | Alerts still arrive from the session list, another chat, or a backgrounded app without duplicating the chat currently being watched. |
| TermDeck | Optional desktop-only, idempotent creation/opening of a TermDeck terminal attached to a Codex HAPI session. | The same session can be opened in the native terminal UI without making TermDeck a dependency for phone use or normal HAPI startup. |
| Maintenance and releases | Upstream is reviewed and merged into `custom` with a real merge commit. Syncing never authorizes publishing, signing, deployment, or a force-push. | Fork behavior and security boundaries are reviewed instead of being overwritten by upstream updates. |

No upstream product subsystem is intentionally presented as removed. The important operational difference is distribution: upstream npm packages, release downloads, and self-update instructions install upstream HAPI, not this fork.

## Install and run this fork

The default branch is `custom`. Build from source with Bun 1.4.0:

```bash
git clone --branch custom YOUR_FORK_CLONE_URL hapi
cd hapi
bun install --frozen-lockfile
bun run build:single-exe
```

Replace `YOUR_FORK_CLONE_URL` with the URL from this repository's **Code** menu. Do **not** use `npx @twsxtd/hapi` or upstream release binaries when you expect the custom behavior described above. Runner version handoff can activate a custom binary that you installed, but it does not download fork updates.

For an existing Linux user-systemd installation configured to run the custom binary, this repository includes a guarded local deployment command:

```bash
bun run deploy:local-hub
```

It type-checks and tests the Hub, builds the embedded web client and executable, keeps the previous binary for rollback, restarts the Hub, and pins future runner launches to the same custom executable. Its defaults expect `hapi-hub.service`, `hapi-runner.service`, and `~/.local/lib/hapi-custom/current/hapi`; override them with `HAPI_SERVICE_NAME`, `HAPI_RUNNER_SERVICE_NAME`, and `HAPI_INSTALL_PATH`. Review [the deployment script](scripts/deploy-local-hub.sh) before using it on another machine.

General upstream configuration still applies: [installation and environment](docs/guide/installation.md), [agents](docs/guide/agents.md), [Web/PWA](docs/guide/pwa.md), and [notifications](docs/guide/notifications.md).

## Optional TermDeck integration

Configure the runner process environment; the repository contains no default hosts, tokens, usernames, or machine paths:

- `HAPI_TERMDECK_API_URL` — machine-local TermDeck API origin.
- `HAPI_TERMDECK_PUBLIC_URL` — browser-visible TermDeck origin.
- `HAPI_TERMDECK_TOKEN_FILE` — file containing the bearer token (preferred).
- `HAPI_TERMDECK_TOKEN` — direct token alternative when a token file cannot be used.

Both URLs and one token input are required for the integration. If TermDeck is unavailable, the HAPI session still starts. See the [runner documentation](cli/src/runner/README.md#optional-termdeck-integration).

## Security and private configuration

- Keep Hub tokens, Telegram bot tokens, TermDeck tokens, public/private hostnames, and local filesystem paths outside Git.
- Workspace browsing is restricted to roots explicitly supplied with `hapi runner start --workspace-root <path>`.
- Prefer `HAPI_TERMDECK_TOKEN_FILE` so the TermDeck secret is not embedded in a service definition.
- Treat YOLO mode as dangerous: it bypasses the agent's normal approval and sandbox protections.
- Exposing the Hub or enabling Telegram still requires the authentication, TLS, tunnel, and `HAPI_PUBLIC_URL` guidance from upstream; a local deployment does not make the Hub safely public by itself.

See [SECURITY.md](SECURITY.md) and the [fork synchronization policy](FORK_SYNC.md) before changing authentication, namespaces, command execution, notifications, file access, runner control, external links, or release workflows.

## Updating from upstream

The permanent policy is documented in [FORK_SYNC.md](FORK_SYNC.md). In short, upstream changes are reviewed and merged from `upstream/main` into `custom` with `--no-ff`; fork features, security boundaries, restricted release workflows, and tests must survive the merge. Do not rebase or force-push the maintained branch.

## License and upstream credit

HAPI means “哈皮”, a Chinese transliteration of [Happy](https://github.com/slopus/happy). The original HAPI project and its contributors remain the source of the product; this repository maintains a focused downstream adaptation.
