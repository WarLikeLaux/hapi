[English](README.md) · [Русский](README-ru.md)

# HAPI custom fork

This is a maintained downstream fork of [HAPI](https://github.com/tiann/hapi) for a local-first agent workflow shared between a desktop terminal and a phone through the Web/PWA client. It keeps the upstream agent, Hub, and Web/PWA architecture while adapting session navigation, project launching, review tools, and messaging.

For the complete product overview, supported agents, and architecture, read the **[canonical upstream README](https://github.com/tiann/hapi#readme)**. This page documents only the differences and operational rules of this fork.

## What this fork changes

| Area | Fork behavior | Practical effect |
| --- | --- | --- |
| Session navigation | Separate Working, Active, keepalive-only Idle, and Recent sections; stable activity-based ordering; unread state; project/global pins; inactive-session filtering; project and Git-branch labels; and project-wide HAPI session cleanup that retains local agent transcripts. | The sessions that need attention stay visible with enough project context, while quiet connected processes and old sessions do not obscure current work. |
| Projects and new sessions | Searchable, sortable, pinnable workspace roots, manual folder selection, continuation of an existing session in another allowed folder, Codex first in the picker, and the first configured workspace root as the initial directory. | A runner scoped to a multi-project directory can launch or continue Codex in any allowed project without source-code path constants. |
| Files and review | The Files screen separates search in changed files from project-wide directory search. Changes can show the working tree, the last commit, or the current branch against its detected base branch, either per file or as one full diff. Agent responses can include their workspace changes, and attached DIFIT reviews and merge requests appear in the session header. | A phone can inspect pending work, each response's edits, the complete branch delta, and an external review without opening every file individually. |
| Agent defaults and lifecycle | New Codex sessions initially use YOLO mode; explicit later choices are remembered. Stop, reopen, restart, cold-start recovery, and Codex history sync preserve clearer lifecycle and activity timestamps. Supported agents are prompted to keep Russian task titles aligned with the current objective; Codex titles can also be regenerated from the session menu. Antigravity receives session-scoped HAPI title and media tools without replacing user-managed MCP servers. | Starting work is faster, switching between HAPI and a local agent is less disruptive, and long-running chats remain identifiable. **Codex YOLO disables sandbox restrictions and routine tool-call approval prompts, but explicit execpolicy `prompt` rules and MCP flows that require user input still reach HAPI.** |
| Chat and mobile UI | Intermediate reasoning and tool activity are grouped behind one `Show work` action. Mobile Enter inserts a newline, the send control is touch-friendly, active chats stay pinned to the latest messages, and background replies are prefetched. Working and delivery indicators recover from stale external turns. HTML artifacts sent through HAPI open in a new browser tab inside a sandboxed preview instead of requiring a download first. | The transcript stays compact and current, phone input behaves like a messaging app, and generated diagrams or reports are one tap away without receiving access to HAPI's authenticated origin. |
| Telegram account chats | An opt-in MTProto connector adds selected Telegram dialogs to a dedicated Chats screen. It supports live text and media, avatars and grouping, aliases, reactions, delivery/read indicators, and synchronized inbox read state. | HAPI can act as a focused Telegram client without copying every dialog into Hub storage. This uses a Telegram user account and is separate from bot notifications. |
| Telegram bot notifications | Notifications link directly to the agent session and are suppressed only while that exact chat is visibly open. | Alerts still arrive from the session list, another chat, or a backgrounded app without duplicating the chat currently being watched. |
| Maintenance and releases | Upstream is reviewed and merged into `custom` with a real merge commit. Syncing never authorizes publishing, signing, deployment, or a force-push. | Fork behavior and security boundaries are reviewed instead of being overwritten by upstream updates. |
| Client scope | The upstream `ios/` and `android/` projects, their CI/release workflows, and native-app build guide are intentionally removed. | This fork is Web/PWA-only and does not download or build mobile SDK projects. |

The important operational difference is distribution: upstream npm packages, release downloads, and self-update instructions install upstream HAPI, not this fork. Upstream native-app build instructions do not apply here.

## Install and run this fork

The default branch is `custom`. Build from source with Bun 1.4.0:

```bash
git clone --branch custom https://github.com/WarLikeLaux/hapi.git
cd hapi
bun install --frozen-lockfile
bun run build:single-exe
```

Do **not** use `npx @twsxtd/hapi` or upstream release binaries when you expect the custom behavior described above. Runner version handoff can activate a custom binary that you installed, but it does not download fork updates.

For an existing Linux user-systemd installation configured to run the custom binary, this repository includes a guarded local deployment command:

```bash
bun run deploy:local-hub
```

It type-checks and tests the Hub, builds the embedded web client, HAPI executable, and Telegram connector, keeps the previous binaries for rollback, restarts the Hub, and pins future runner launches to the same custom executable. This path requires Go as well as Bun. Its defaults expect `hapi-hub.service`, `hapi-runner.service`, and `~/.local/lib/hapi-custom/current/hapi`; override them with `HAPI_SERVICE_NAME`, `HAPI_RUNNER_SERVICE_NAME`, and `HAPI_INSTALL_PATH`. Review [the deployment script](scripts/deploy-local-hub.sh) before using it on another machine.

General upstream configuration still applies: [installation and environment](docs/guide/installation.md), [agents](docs/guide/agents.md), [Web/PWA](docs/guide/pwa.md), and [notifications](docs/guide/notifications.md).

### Optional Telegram account chats

The Chats screen uses a separate MTProto sidecar, not the Telegram bot used for agent notifications. Build it with `bun run build:telegram-connector` and place `connectors/telegram/hapi-telegram-connector` beside the installed HAPI executable; `deploy:local-hub` does this automatically. The UI then asks for an API ID and hash from [my.telegram.org](https://my.telegram.org/apps), followed by the account's phone, login code, and optional 2FA password.

The connector stores credentials and its MTProto session with owner-only permissions below the HAPI data directory. Only dialogs explicitly selected in the UI are cached by HAPI. See the [connector guide](connectors/telegram/README.md) for development and custom binary paths.

## Security and private configuration

- Keep Hub tokens, Telegram bot tokens, Telegram API credentials and sessions, public/private hostnames, and local filesystem paths outside Git.
- Workspace browsing is restricted to roots explicitly supplied with `hapi runner start --workspace-root <path>`; without them it falls back to the runner user's home directory rather than the whole filesystem.
- Treat YOLO mode as dangerous: it bypasses the agent's normal approval and sandbox protections except for explicit execpolicy `prompt` rules and MCP flows that require actual user input.
- Exposing the Hub or enabling Telegram still requires the authentication, TLS, tunnel, and `HAPI_PUBLIC_URL` guidance from upstream; a local deployment does not make the Hub safely public by itself.

See [SECURITY.md](SECURITY.md) and the [fork synchronization policy](FORK_SYNC.md) before changing authentication, namespaces, command execution, notifications, file access, runner control, external links, or release workflows.

## Updating from upstream

The permanent policy is documented in [FORK_SYNC.md](FORK_SYNC.md). In short, upstream changes are reviewed and merged from `upstream/main` into `custom` with `--no-ff`; fork features, security boundaries, restricted release workflows, and tests must survive the merge. Do not rebase or force-push the maintained branch.

## License and upstream credit

HAPI means “哈皮”, a Chinese transliteration of [Happy](https://github.com/slopus/happy). The original HAPI project and its contributors remain the source of the product; this repository maintains a focused downstream adaptation.
