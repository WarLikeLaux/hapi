---
description: "Fork, rewind and export HAPI conversations, with per-agent support for Claude Code, Codex, OpenCode, Grok and Pi."
---

# Fork, rewind and export

HAPI gives you three ways to work with a conversation's history:

| Action | What it does | Source session |
|--------|--------------|----------------|
| **Fork** | Creates a new session that continues from a point in the agent's own (native) history | Unchanged |
| **Rewind** | Removes history from a user message onward, in place | Shortened permanently |
| **Export** | Downloads the conversation as JSON or Markdown | Unchanged |

None of these touch your files. A fork or rewind changes only the conversation; your working tree stays as it is. For isolated code changes, create a separate Git worktree.

## Which agents support what

Fork and rewind use each agent's own history API, so support depends on the agent. HAPI shows a control only after the agent reports that it supports it. If you don't see a button, the session doesn't support that action.

| Agent | Fork latest turn | Fork at a message | Rewind | Fork from session list |
|-------|------------------|-------------------|--------|------------------------|
| Claude | Yes | — | — | — |
| Codex | Yes | Yes, also while a turn is running | — | Yes (active and archived) |
| Grok Build | Yes¹ | Yes¹ | Yes¹ | — |
| Pi | Yes¹ | Yes¹ | Yes¹ | — |
| Gemini, Kimi, Copilot, Cursor, Antigravity, DeepSeek Harness | — | — | — | — |

¹ Detected when the session starts. HAPI shows the control only if the installed agent version provides the API:

- **Grok Build:** its fork and rewind extension methods.
- **Pi:** its fork and history-entry RPC commands. HAPI's code assumes Pi 0.83 or later.

Export works for every session, whatever the agent.

## Fork

A fork creates a new HAPI session from a copy of the agent's native conversation and opens it. Its title starts as **Fork: _source title_**. The new session gets the transcript up to the fork point, and the source session isn't changed.

### Fork from the latest turn

When the agent finishes a turn, a **Fork** button appears in the action row of the latest message. Forking there keeps the whole conversation so far.

### Fork at a message

On agents that support it, earlier user messages also show **Fork**. The new session keeps everything **before** that message. The message you picked and everything after it are left out, so you can send a different prompt from that point.

A message gets the button only if HAPI recorded a native history point for it. Messages from before the agent supported history points, or messages HAPI couldn't map to a native turn, have no button.

### Fork while Codex is working

Codex can fork a completed turn while another turn is still running:

- **In chat:** user messages whose turns have completed keep their **Fork** button while Codex works on a later turn.
- **From the session list:** open the session's menu and choose **Fork session**. If a turn is running, HAPI forks **through the last completed turn**. The running turn is left out, and the source session keeps working. If no turn has completed yet, the action is disabled and explains why.

### Fork an archived Codex session

You can also fork an inactive Codex session from its chat, or an archived one from the session list. The source machine must be online, and its runner must support archived Codex forks. HAPI forks the stored native thread without reopening the source and without sending it a prompt. For recovery details, see [Codex shared sessions → Fork an archived conversation](./codex-shared-sessions.md#fork-an-archived-conversation).

### When fork is unavailable

HAPI refuses a fork, apart from the Codex cases above, when:

- the agent is still working on a turn
- the session has queued messages that haven't been sent yet
- the session is running in local (terminal) mode. Use remote mode. Codex shared sessions don't have this restriction.
- the session's native history no longer matches HAPI's copy

## Rewind

**Rewind** appears on user messages for Grok Build and Pi. It removes that message and everything after it from the session, both in the agent's native history and in HAPI's transcript. You then continue from the turn before it. After you confirm, the chat refreshes to the shortened history.

::: warning
Rewind permanently deletes the later conversation, and files are not restored. To keep the original, fork instead.
:::

You can't rewind while the agent is working, while messages are queued, in local (terminal) mode, or on an inactive session. Codex doesn't offer rewind. Fork at the message instead.

## Export

Export the conversation from the web app's session header menu or the session list's action menu (**Export conversation**):

| Format | Contents |
|--------|----------|
| **JSON** | Lossless payload: session metadata, all visible messages and scratchlist notes. Attachments are included as metadata only (name, type, size, path), not file contents. |
| **Markdown** | A readable document generated from the same payload |

The file is named `<title>-<id prefix>-<date>.json` or `.md`.

- **Over 20,000 messages:** HAPI warns you first. You can still choose **Download anyway**.
- **Estimated over 100 MB:** the hub refuses the export.
