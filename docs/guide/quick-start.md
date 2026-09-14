# Quick Start

<Steps>

## Install HAPI

```bash
npm install -g @twsxtd/hapi --registry=https://registry.npmjs.org
```

Other install options (Homebrew, npx, prebuilt binary, source): [Installation](./installation.md#install-the-cli)

## Start the hub

```bash
hapi hub --relay
```

On first run, HAPI prints an access token and saves it to `~/.hapi/settings.json`. Open the displayed web URL or scan its QR code.

Details and local-only mode: [Hub setup](./installation.md#hub-setup)

## Start a coding session

```bash
hapi
```

Choose an installed agent from the picker. Its session appears in connected Web/PWA clients.
To start one directly, use `hapi claude`, `hapi codex`, or another
[supported agent command](./agents.md). Scripts must specify the agent explicitly.

## Open the UI

- **Web / PWA:** open the web URL shown in the terminal, or scan the web QR code. Enter your access token if prompted.

</Steps>

## Next steps

- [Seamless Handoff](./how-it-works.md#seamless-handoff) - Switch between terminal and phone seamlessly
- [Hub setup](./installation.md#hub-setup) - Access HAPI from anywhere
- [Notifications](./notifications.md) - Web Push, Telegram and ServerChan notifications
- [Deployment](./deployment.md) - Run HAPI as a persistent background service
- [Install the PWA](./pwa.md) - Add the web app to your home screen
