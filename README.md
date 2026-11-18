[English](README.md) · [Русский](README-ru.md)

# HAPI custom fork

This maintained fork of [tiann/hapi](https://github.com/tiann/hapi) is for running coding agents on your own machines and managing their work from a desktop browser or a phone. It builds on HAPI’s CLI, Hub and Web/PWA with tools for working across projects, coordinating agents and reviewing changes from a phone.

The `custom` branch includes the upstream 0.36.5 merge and subsequent fork fixes. For the original product overview, use the [upstream README](https://github.com/tiann/hapi#readme), [upstream documentation](https://hapi.run/docs/) and [0.36.5 release notes](https://github.com/tiann/hapi/releases/tag/v0.36.5). Use the instructions below to install and open the fork.

## What this fork adds

| Area | What you can do |
| --- | --- |
| **Session list** | Find chats by project, branch or message text. Working sessions follow your activity, while Active and Recent follow agent activity. Keepalive-only and parked sessions can appear in Idle. Pins, muted chats and Hub-synced read state help you manage the same list on desktop and phone. You can mark everything read in one action or delete a project’s HAPI sessions while keeping the agents’ local transcripts. |
| **Projects and groups** | Search, sort and pin projects, choose a workspace directory and launch one or several independent chats with shared or per-chat prompts. Named chat groups have ordered, pinnable tabs and can be parked when idle. Supported agents can discover projects, launch other agents into groups and coordinate through HAPI’s MCP tools. |
| **Agent settings and lifecycle** | Save project and model preferences and select effort or speed where the agent supports them. Codex offers Fast and Ultrafast when the model and account allow them. Kimi can use models from the selected project’s configured providers. Supported agents can keep Russian task titles current, and users can protect titles by renaming them. Stop, reopen and restart controls let you manage sessions from Web/PWA. |
| **Chat and phone workflow** | Expand intermediate tool calls and reasoning with **Show work**. On a phone, Enter inserts a newline by default and drafts survive switching apps. Codex’s live non-blocking questions can be answered or dismissed in a panel above the composer. Starting a newer turn clears stale questions from that panel. |
| **Files and review** | Search changed files or the whole project. Review the working tree, the last commit or the branch against its detected base as a full diff or file by file. See file changes in Codex patch cards and follow attached review links. Open generated HTML in a sandboxed browser preview. |
| **Messaging** | Connect personal Telegram or Yandex Messenger accounts to the **Chats** screen and choose which dialogs to show. Telegram bot notifications for agent activity link to the session and are suppressed while that exact chat is visibly open. |
| **Usage** | See runner-reported account limits in **Settings → Limits**, including on-demand Claude Code plan refresh. **Settings → Usage** shows recorded token totals for the Hub owner. Cursor quota percentages are estimates. |

See the fork’s [Web client guide](web/README.md), [agents](docs/guide/agents.md), [peer sessions](docs/guide/peer-sessions.md) and [usage and quotas](docs/guide/usage-and-quotas.md) for details.

## Upstream features and fork limits

- **Clients.** The fork ships its own Web/PWA and retains the Telegram Mini App. The upstream iOS and Android source trees, build and store workflows, and native-app guide are intentionally omitted. Some companion API and push support remains in the Hub. Use the Web/PWA served by your fork Hub to get the fork’s interface. The public relay’s sign-in link and QR code point to the upstream hosted Web app by default. [Web/PWA](docs/guide/pwa.md) · [Remote access and self-hosted tunnels](docs/guide/deployment.md)
- **Sign-in and title generation.** Use the Hub access token for browser sign-in. Upstream passkey sign-in is unavailable in this tree. The Hub can request a title on demand when a title provider is configured. That action sends recent conversation text to the provider. Automatic first-turn Hub title requests are disabled by fork policy. Agents can still name their sessions, and Codex can regenerate a title from the session menu. [Fork synchronization policy](FORK_SYNC.md)
- **Conversation history.** Terminal/Web shared Codex sessions are available with Codex 0.154.0 or newer. Upstream’s `hapi attach` for external Codex runtimes and cross-agent/model branching are unavailable in this tree. The fork keeps its own conversation fork actions where supported. Its non-blocking question panel is a Web feature. [Codex shared sessions](docs/guide/codex-shared-sessions.md) · [Local history import](docs/guide/import-local-sessions.md)
- **Hidden and retired controls.** Work/Lab/Chill context controls are hidden. The list shows every context and retains stored assignments. Date filtering is in expanded search. The separate unread-only button and DIFIT integration were removed. MAX account chats are paused, with saved accounts and history kept. [Fork synchronization policy](FORK_SYNC.md) · [MAX account chats](hub/README.md#max-account-chats-temporarily-disabled)

## Install and run this fork

Build from the default branch `custom` with Bun 1.4.4. The build downloads the `tunwg` relay helper and embeds the Web client. Install and authenticate at least one supported agent separately.

```bash
git clone --branch custom https://github.com/WarLikeLaux/hapi.git
cd hapi
bun install --frozen-lockfile
bun run build:single-exe
```

The executable is under `cli/dist-exe/<target>/hapi` (`hapi.exe` on Windows). Put it on your `PATH` and make sure `hapi` resolves to that executable. The upstream npm package `@twsxtd/hapi`, Homebrew tap, release downloads and update instructions serve upstream HAPI.

```bash
hapi hub --no-relay
```

Open the Hub’s local Web URL (by default `http://127.0.0.1:3006`) and sign in with the access token printed on first launch. In another terminal, run `hapi` to choose an agent or `hapi codex` to start Codex directly. To launch sessions from the browser, start a Runner on the machine with your agent and projects, for example `hapi runner start --workspace-root ~/projects`. On a separate machine, configure the same Hub URL and access token. [Configuration](docs/guide/configuration.md) · [CLI and Runner](cli/README.md) · [Notifications](docs/guide/notifications.md)

### Updating an installed fork

In the fork checkout on `custom`, run `git pull --ff-only origin custom`, then repeat the install and build commands above. Replace the installed executable and update the Hub, Runner and CLI on each machine together. Back up your Hub data before updating. Runner version handoff can switch to a compatible executable you installed locally.

For an existing Linux user-systemd installation, use `bun run deploy:local-hub` from the main checkout on `custom`. It requires Go 1.25 or newer as well as Bun. It builds and installs the executable and Telegram connector, keeps the previous binaries and restarts the Hub. By default it also type-checks and tests the Hub. If the Runner unit exists, the script pins future launches to the installed executable and restarts an active Runner only with `KillMode=process`. Defaults are `hapi-hub.service`, `hapi-runner.service` and `~/.local/lib/hapi-custom/current/hapi`. Set `HAPI_SERVICE_NAME`, `HAPI_RUNNER_SERVICE_NAME` or `HAPI_INSTALL_PATH` to match your configuration. The Hub unit’s `ExecStart` must already point to the install path. [Deployment script](scripts/deploy-local-hub.sh)

### Optional account chats

For Telegram, build the MTProto connector with `bun run build:telegram-connector` (Go 1.25 or newer). Place `connectors/telegram/hapi-telegram-connector` beside the installed HAPI executable, adding the `.exe` suffix to the connector on Windows. The Linux deployment command does this for you. In **Chats**, connect with an API ID and hash, then complete phone, login code and optional 2FA prompts. Yandex Messenger uses the signed-in account’s messenger cookies. Treat both connectors’ credentials as account secrets. The Hub caches the dialogs you select. Bot notifications use their own bot token. [Telegram connector guide](connectors/telegram/README.md) · [Telegram API credentials](https://my.telegram.org/apps)

## Local development

Use the same clone and dependency installation as above, plus Node.js 22.12 or newer for the Web dev server. From the repository root, start the Hub and Vite with development data in a separate directory.

```bash
export HAPI_HOME="$HOME/.hapi-dev"
bun run dev
```

Open the Vite URL printed in the terminal and sign in with the dev Hub’s access token. Vite proxies API requests to the Hub on port 3006 by default. If another Hub is already listening there, set `HAPI_LISTEN_PORT` and set `VITE_HUB_PROXY` to the matching local URL before starting development. To run the source CLI against the dev Hub, use the same `HAPI_HOME` in another terminal and run `bun run --cwd cli dev codex`. Set `HAPI_API_URL` there if you changed the port. [Contributing](CONTRIBUTING.md) · [Hub development](hub/README.md#running) · [Web development](web/README.md#development) · [Pitbox and UI previews](scripts/tooling/README.md)

## Security and maintenance

- Check permissions when creating a Codex session in Web. The default for a fresh Codex launch form is YOLO. YOLO disables the agent sandbox and routine tool approvals. Explicit execpolicy prompts and MCP requests that need your input can still appear.
- Explicit Runner workspace roots constrain browsing and spawning. Without roots, directory lookups are scoped to the Runner user’s home, and manual spawning can still access other paths available to that user. Workspace roots are separate from agent sandbox permissions.
- Keep tokens, messenger credentials and machine-specific settings out of Git. For remote use, configure authentication and HTTPS. Set `HAPI_PUBLIC_URL` to your public HTTPS origin for the Telegram Mini App. [Security policy](SECURITY.md) · [Namespaces](docs/guide/namespace.md) · [Remote access](docs/guide/deployment.md)

Maintainers review changes from `upstream/main` and make a real `--no-ff` merge into `custom`. The fork runs **Test** in CI and checks **fixtures** when the relevant paths change. Keep the workflow restrictions and retain the merged history without rebasing or force-pushing. Publishing, signing and deployment require separate authorization. [Fork synchronization policy](FORK_SYNC.md) · [Repository workflow](AGENTS.md)

## License and credits

HAPI comes from [tiann/hapi](https://github.com/tiann/hapi) and builds on [Happy](https://github.com/slopus/happy). This fork is licensed under [AGPL-3.0](LICENSE).
