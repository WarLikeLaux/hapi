# Fork synchronization policy

This repository is a maintained personal fork of `tiann/hapi`. Upstream changes are reviewed and merged into the `custom` branch; they are never applied as a blind overwrite or history rewrite.

## Branches and remotes

- Fork target: `origin/custom`
- Upstream source: `upstream/main`
- Synchronization method: a real `--no-ff` merge commit whose first parent is the previous `custom` tip and whose second parent is the reviewed upstream tip.
- Never force-push the synchronization result.

## Mandatory fork behavior

Upstream changes must preserve these user-visible extensions and their tests:

- The session list keeps the fork's Working, Active, Recent, project, global-pin, unread, and inactive-session behavior. Working sessions use the latest user activity; Active and Recent sessions use agent activity. Search may re-rank matching rows, but must not silently replace the normal activity ordering.
- Keep chat groups, muted sessions, project/model preferences and the default Codex model. Work/Lab/Chill context controls are hidden and all sessions are shown; preserve existing stored context assignments for possible restoration. The separate unread-only button and collapsed-search calendar were deliberately removed; date filtering stays inside search.
- Keep Hub-backed read-state synchronization between desktop Web and phone PWA. Migrate existing browser unread choices once into the shared state instead of silently discarding them; preserve newer shared choices, offline retry and rendered-tail acknowledgement. Retain muted-session, badge and bulk mark-all behavior.
- Manual titles use `nameLock: 'user'`; agent-pinned role titles use `nameLock: 'agent'`. Sparse metadata writes, imports, native history and automatic suggestions must preserve ownership. Upstream's optional boolean lock must not make a manual rename writable by agents again.
- Preserve durable message placement, FIFO delivery, idempotent retries, asynchronous Codex questions and native recaps. Keep conversation-unit history budgets and the initial two user/assistant exchanges.
- Keep the fork's dedicated non-blocking Codex async-question state, stable question/answer IDs and persistent dismissal. Old questions stop requiring attention when a newer turn starts, as explicitly requested by the user. Do not register a second generic permission-card implementation or keep stale unanswered questions across later turns. Native-terminal answer interoperability is not required for this fork.
- Workspace selection remains practical for a local multi-project directory: project search, sorting, pinning, manual selection, and the configured default Codex workspace/YOLO behavior remain available without repository-specific or user-specific paths being hardcoded.
- Session lifecycle additions remain intact: stop/reopen/restart, Codex sync time preservation, and project-level session cleanup.
- Mobile composer behavior and session-aware Telegram notification suppression remain intact.
- Assistant responses keep intermediate reasoning/tool events behind one `Show work` affordance, while title and compaction lifecycle events remain associated with the surrounding response.
- This fork ships the Web/PWA client only. The upstream `ios/**` and `android/**` trees, their GitHub Actions workflows, store-release automation, and local native-app guide are intentionally absent and must be removed again during every upstream synchronization if upstream reintroduces them.

## Security and data boundaries

- Preserve HAPI namespace isolation, authentication checks, safe link handling, and versioned state-update invariants.
- Hub title-provider requests remain on demand. Do not enable upstream's automatic first-turn title fallback through existing provider credentials; separate-model title ownership requires a separate product decision. Keep agent-generated titles, protected user/agent names and manual title generation.
- Without explicit runner workspace roots, directory browsing must remain limited to the runner user's home directory; manual spawning may retain its legacy behavior. Configured roots constrain both browsing and spawning.
- Archived workspace reads use the browsing boundary, including symlink resolution and bounded regular-file reads. Optional OpenCode REST discovery must prove that the identified serve process owns the selected listener; never send its credential to a whole-host port-scan fallback.
- Preserve global image-viewer ownership, per-message galleries, sandboxed HTML media, editor/deep-line links and the absence of authenticated API data in the PWA service-worker cache.
- Do not weaken tenant/Hub storage separation or expose Hub-only configuration to tenant namespaces.
- Check namespace access before returning a coalesced resume/reopen result. Codex archived-fork and resume reservations are Hub-owned; CLI metadata must not forge or erase them through socket updates, creation or preallocated-session adoption. Treat null reconnect snapshots as sparse writes. Preserve native ownership/journals and refuse retries that cannot prove whether a fork or launcher already started.
- Hub display-title/config writes must not resolve a pending machine launch. Metadata-based adoption of a machine-spawn stub requires a valid incoming CLI process ID; keep ambiguous launch receipts until the agent connects.
- Append database migrations after the fork's current schema version. Upstream version numbers may already be assigned to different migrations here. Preserve the fork's user-activity and Telegram data when adding upstream tables or indexes.
- Machine-global Claude, Codex and DSH model discovery runs from the user's home directory. Keep project configuration out of those probes. Project-scoped catalogs may use the explicitly selected workspace.
- Do not add committed secrets or machine-specific deployment configuration.
- Treat changes to authentication, namespace scoping, command execution, notifications, runner control, file access, external links, and release workflows as security-sensitive and review them manually.

## CI and release policy

- Preserve the fork's existing workflow trigger and permission restrictions.
- Upstream release, publishing, Pages, native-app build/signing, image publishing, and automated response workflows are not authorization to publish from this fork. Synchronization does not trigger a release or deployment unless separately requested.
- Follow `AGENTS.md`: targeted tests for changed behavior and necessary affected typechecks. The full suite runs in CI; a full local run needs a separate explicit user request. Monitor `Test` and, when its path filters match, `fixtures` on the exact pushed commit. Preserve existing CI permissions, trigger restrictions and disabled publishing automation.

## Review checklist

Before completing a sync:

1. Read every upstream-only commit and its complete diff.
2. Merge with `git merge --no-ff --no-commit upstream/main` in an isolated worktree unless the user explicitly assigns the main checkout. Preserve concurrent changes and wait until another writer releases that checkout.
3. Review both `old-custom..result` and `upstream-tip..result` so upstream additions and retained fork behavior are both explicit.
4. Resolve conflicts by adapting upstream behavior to this policy; do not choose a whole side when that drops behavior from the other side.
5. Run focused tests, necessary typechecks, fixture generation when required, and `git diff --check` before committing. Follow the user's delivery order; an explicit CI-before-deploy gate overrides the usual local deploy order.
6. Verify the upstream tip is an ancestor and the merge commit has exactly the expected two parents before fast-forwarding and pushing `custom`.
