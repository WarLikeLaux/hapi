# HAPI Telegram connector

This is the MTProto sidecar used by the hub's generic messenger layer. It uses a
Telegram user account (not a bot) and communicates with the hub through newline
delimited JSON on stdin/stdout.

Build it with:

```sh
go build -o hapi-telegram-connector .
```

During development the hub falls back to `go run .` when the binary is absent.
Set `HAPI_TELEGRAM_CONNECTOR_BIN` to use a binary from another location.
For an installed HAPI executable, place `hapi-telegram-connector` (or the
`.exe` variant on Windows) beside the HAPI executable.

Create an API ID and hash at <https://my.telegram.org/apps>. The HAPI UI asks
for these values and then walks through phone, login code, and optional 2FA.
Credentials and the MTProto session are stored below HAPI's data directory with
owner-only permissions. Only explicitly selected dialogs are cached by HAPI.
