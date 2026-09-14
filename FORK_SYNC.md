# Fork synchronization policy

This repository is a maintained personal fork of `tiann/hapi`. Upstream changes
are reviewed and merged into the `custom` branch; they are never applied as a
blind overwrite or history rewrite.

## Branches and remotes

- Fork target: `origin/custom`
- Upstream source: `upstream/main`
- Synchronization method: a real `--no-ff` merge commit whose first parent is
  the previous `custom` tip and whose second parent is the reviewed upstream tip.
- Never force-push the synchronization result.

## Mandatory fork behavior

Upstream changes must preserve these user-visible extensions and their tests:

- The session list keeps the fork's Working, Active, Recent, project, global-pin,
  unread, and inactive-session behavior. Working sessions use the latest user
  activity; Active and Recent sessions use agent activity. Search may re-rank
  matching rows, but must not silently replace the normal activity ordering.
- Workspace selection remains practical for a local multi-project directory:
  project search, sorting, pinning, manual selection, and the configured default
  Codex workspace/YOLO behavior remain available without repository-specific or
  user-specific paths being hardcoded.
- Session lifecycle additions remain intact: stop/reopen/restart, Codex sync time
  preservation, and project-level session cleanup.
- Optional TermDeck integration remains desktop-only, idempotent, and driven by
  local runtime configuration. Private hosts, tokens, usernames, and local paths
  must never be committed.
- Mobile composer behavior and session-aware Telegram notification suppression
  remain intact.
- Assistant responses keep intermediate reasoning/tool events behind one
  `Show work` affordance, while title and compaction lifecycle events remain
  associated with the surrounding response.
- This fork ships the Web/PWA client only. The upstream `ios/**` and `android/**`
  trees, their GitHub Actions workflows, store-release automation, and local
  native-app guide are intentionally absent and must be removed again during
  every upstream synchronization if upstream reintroduces them.

## Security and data boundaries

- Preserve HAPI namespace isolation, authentication checks, safe link handling,
  and versioned state-update invariants.
- Without explicit runner workspace roots, directory browsing must remain
  limited to the runner user's home directory; manual spawning may retain its
  legacy behavior. Configured roots constrain both browsing and spawning.
- Do not weaken tenant/Hub storage separation or expose Hub-only configuration
  to tenant namespaces.
- Do not add committed secrets or machine-specific deployment configuration.
- Treat changes to authentication, namespace scoping, command execution,
  notifications, runner control, file access, external links, and release
  workflows as security-sensitive and review them manually.

## CI and release policy

- Preserve the fork's existing workflow trigger and permission restrictions.
- Upstream release, publishing, Pages, native-app build/signing, image publishing, and
  automated response workflows are not authorization to publish from this fork.
  Synchronization does not trigger a release or deployment unless separately
  requested.
- Required local validation for a normal sync is `bun run typecheck` and
  `bun run test`. Run focused tests for every conflict or adapted behavior.

## Review checklist

Before completing a sync:

1. Read every upstream-only commit and its complete diff.
2. Merge with `git merge --no-ff --no-commit upstream/main` in an isolated
   worktree.
3. Review both `old-custom..result` and `upstream-tip..result` so upstream
   additions and retained fork behavior are both explicit.
4. Resolve conflicts by adapting upstream behavior to this policy; do not choose
   a whole side when that drops behavior from the other side.
5. Run focused tests, the full typecheck, the full test suite, and
   `git diff --check` before committing.
6. Verify the upstream tip is an ancestor and the merge commit has exactly the
   expected two parents before fast-forwarding and pushing `custom`.
