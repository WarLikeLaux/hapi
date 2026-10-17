# AGENTS.md

HAPI is a local-first platform for running coding agents with remote control via web/phone.
CLI wraps agents → hub (Socket.IO) → Web/PWA clients (REST + SSE).

## Task boundaries

- Complete the requested deliverable and relevant verification; do not stop at the first implementation unless the user requested a review checkpoint.
- Fix causes within the task's scope. Report unrelated problems rather than turning them into refactors or additional features.
- Make reasonable, reversible choices and continue. Ask when missing information materially affects correctness, an action needs additional authorization, or progress requires overwriting someone else's changes. Continue unaffected work.
- Preserve existing user/agent changes. Follow the delivery policy below for task changes; editing or generating unrelated files never implies permission to commit, push, or release them.
- Before every ordinary commit, invoke the global user-level `commit` skill and read its `SKILL.md`, including in Pitbox slots and when committing automatically under the delivery policy below. This is mandatory for all agents, including MiniMax. Use only the skill from the agent's global skill catalog, never a project-local copy. Follow its workflow and commit message format. Let Git create merge commits with its default message.
- Keep communication concise and clear; report results, checks performed, and remaining limitations.

## Product coordinator

- Act as the product coordinator when the user asks for that role. Discuss feature ideas, alternatives, user scenarios, scope, and expected behavior with the user. Describe the product outcome clearly enough for a worker to implement it.
- Leave technical investigation, architecture, implementation planning, code changes, and verification to the worker. Include technical constraints already agreed with the user, but do not prescribe files, APIs, or implementation steps on the worker's behalf.
- Launch workers when the user authorizes the discussed work. Discussion alone is not a launch request. Existing authorization remains valid within its agreed scope.
- Use HAPI `launch_agent` to start each task in its own worker session. Pass the product brief and relevant agreed context, let the worker claim its own Pitbox slot under the routing rules below, and give the user a link to each session.
- Default to `agent: "codex"` and omit `model` and `effort` so the worker uses Codex's configured defaults. Honor the user's executor preferences stated at the start of the coordinator session or updated later, and keep them for subsequent launches until changed. Do not choose a different agent, model, or effort based on estimated task complexity or inherit the coordinator's own settings.
- The user works directly with each worker on questions, new ideas, revisions, and acceptance in that worker's session. Do not route worker results through a central acceptance queue or accept work on the user's behalf. Integration still requires the user's explicit request under the rules below.
- The coordinator does not claim a Pitbox slot or implement feature changes. Workers handle their own slots, checks, and delivery.

## Pitbox task routing

- Starting in the main checkout does not make a session the integrator. For an ordinary coding task, run `pitbox status`, then `pitbox claim` without a slot number. Continue in the returned worktree. If no slot is free, report that instead of working in the main checkout.
- A session that claimed a slot remains its worker. Run the targeted checks required for the change type under Verification and completion below in that slot and fix failures. For visible UI or UX changes, complete the visual review below before committing. Then commit only the task files and run `pitbox ready`. Once the other delivery requirements are met, passing the required targeted checks is sufficient for `pitbox ready`. A full local test suite is not required unless the user separately requested it explicitly. If a required check cannot run, report it and do not mark the slot ready. Do not deploy from any checkout, collect, release, or push the main branch. The direct main-checkout delivery rules below never apply to slot workers.
- After `pitbox ready`, report the slot, branch, commit, and checks in the same HAPI conversation. Keep its history available so integration can inspect it or reopen the session for a fix.
- Integrate ready slots only on the user's explicit request, from a separate session that has done no slot work. Run `pitbox status` and collect the requested slots. Default mode (the user did not explicitly ask for checks): the integrator does not run local tests itself — slot workers already ran their checks in their slots. Merge; if the merge is clean, immediately perform HAPI's required local deployment, verify the affected services, and release the collected slots right after the deployment. Then push the merged `custom` branch and still wait for the `Test` GitHub Actions workflow on that exact commit, along with `fixtures` if the changed paths triggered it, as monitoring only: CI does not gate the deployment or the slot release. Careful mode (the user explicitly asked for checks) and conflicted merges (manual conflict resolution or the integrator changed code): run targeted local checks for those changes on the final merged tree under Verification and completion below before pushing (a general request for checks does not authorize a full local test suite), push the merged `custom` branch, wait for the required workflows on that exact commit to pass, and only then deploy, verify the affected services, and release the collected slots. If required CI is missing or cannot be checked, stop and report it. If required CI fails on the integrated commit, report it and launch a fix agent through the HAPI MCP `launch_agent` tool to fix the failure. Default to `agent: "codex"` and omit `model` and `effort`, honoring any executor preferences the user has set for the session. Integration creates merge commits before deployment. This integration order overrides the deploy-before-push rule below.
- When the user explicitly tells the current session to integrate and deploy on its own, comply in this same session: do not demand or spawn a separate integrator session and do not argue. That explicit instruction overrides the separate-session default above. Everything else in the integration order still applies, including local checks when the integrating session also changed code.
- After integration, tell the user what was integrated: briefly describe the concrete features, fixes, or documentation changes from each collected slot. Include deployment and verification status and any remaining blockers. Slot numbers and commit hashes alone are not a description of the delivered changes.
- Work explicitly assigned to the main checkout follows the delivery policy below, not the integration order above.

## Acceptance and session closure

- Treat a clear acceptance of the delivered change, such as «норм», «нормально», «ок» or «принято», as permission to finish delivery and close the current HAPI session without another confirmation. Agreement with a plan is not acceptance of a delivered result. If the same message requests more work, complete that work before closing.
- Finish the required checks, commit the accepted task files and run `pitbox ready` for slot work. Report the result, slot, branch, commit and checks. Acceptance does not authorize a slot worker to integrate, deploy or release its slot.
- Call the HAPI MCP `close_session` tool as the last tool call, then send the final handoff. It archives only the current session after the turn ends and final messages are flushed. History remains available for inspection and reopening. New user input cancels the pending close.
- Keep the session open while work, required checks or user review are still pending. If `close_session` is unavailable or fails, state that the session could not close automatically.

## Visual review for slot workers

- For visible UI or UX changes, first confirm that the edited source is present in your slot. Start the web dev server from that slot on a free port, for example `bun run --cwd web dev -- --port 5174 --strictPort`. Port 5173 may serve the main checkout and will not show your changes. A dev server used for screenshots is a local preview, not a deployment.
- All agent models use the shared capture CLI from the slot root: `bun scripts/tooling/capture-hapi-ui.mjs --url http://127.0.0.1:5174/sessions/<id> --out /tmp/hapi-ui.png --click 'button[title="More actions"]' --expect '[role="menuitem"]:has-text("Delete")'`. Run `--help` for ordered clicks, form input, hover, scrolling, viewport sizes, and assertions. [Capture examples and troubleshooting](scripts/tooling/README.md) cover settings, session creation, and custom scenarios.
- Capture the real changed page. The CLI authenticates through the Vite origin and its `/api` proxy, scrolls to `--expect`, and verifies that the target fits in the frame. Choose a specific changed control or message. Do not use static HTML replicas or hand-drawn comparisons.
- After every capture, open the actual saved PNG with an image-reading tool and compare what it shows with the user's requested change. Confirm the correct page, changed element, relevant data, and intended state, with enough surrounding context and no clipping or obstructing overlays. A successful capture, selector assertion, or `display_image` call does not replace looking at the image. If the screenshot shows the wrong content or fails to demonstrate the change, correct the preview, interactions, selector, or framing and retake it before claiming completion. If you cannot read images, explicitly report that visual verification is blocked.
- For scenarios beyond CLI actions, import `captureHapiUi` from `scripts/tooling/hapi-ui.mjs`. Use `prepare(page)` before navigation for API fixtures and `interact(page)` afterward for custom Playwright actions. Reuse its browser/auth/framing lifecycle instead of copying token setup into another script. Identify mocked data when presenting a capture. Do not set `hapi_hub_url` to the backend port, store a JWT as an access token, print tokens, or weaken CORS for a preview.
- Send all final screenshots for the task to the user with HAPI `display_image` using their absolute paths, covering the reviewed pages, viewports, and states. Do not limit delivery to one representative image. Failed or superseded draft captures do not need to be sent. Give final images distinct filenames and label what each demonstrates. Wait for explicit visual acceptance before committing or calling `pitbox ready`. If you cannot capture a representative screenshot, explain the blocker and ask the user how to review the change.

## Delivery policy only for work explicitly assigned to the main checkout

- Every completed product code change must be deployed locally after its relevant checks pass. The local deploy command is `bun run deploy:local-hub`. The script itself refuses to run outside the main checkout on `custom`, so Pitbox slots cannot deploy. Local deployment may run while agent sessions are active. Verify the affected services afterward.
- For non-visual features and fixes, successful verification authorizes committing the task's exact files and pushing the current branch without waiting for a separate request. Deploy before commit and push so a failed deployment is not published.
- If a feature or fix does not work on its first delivered attempt and needs another corrective iteration, deploy subsequent fixes for validation but do not commit or push them until the user explicitly confirms the result works. This acceptance gate overrides the non-visual automatic-push rule.
- For changes that affect visible UI or UX, deploy the uncommitted change for user review, but do not commit or push it until the user explicitly accepts the visual result. After acceptance, commit and push the reviewed files.
- A user's explicit request to avoid deployment, commits, or pushes overrides these defaults. Never include unrelated worktree changes in an automatic commit.
- Product code checks follow Verification and completion below: targeted tests for changed behavior and necessary typechecks for affected components. The full test suite runs in GitHub CI. A full local test run requires a separate explicit user request and is not a prerequisite for deployment, commit, or push otherwise.

## Find context when needed

Start with the task's files; read only relevant sections of these references, not a fixed sequence of READMEs.

| Task area | Entry points |
|-----------|--------------|
| Product, setup, supported agents | [README.md](README.md), [agent guide](docs/guide/agents.md) |
| Agent wrappers, CLI commands, runner | [cli/README.md](cli/README.md); for bootstrap/handoff changes, [session lifecycle invariants](cli/README.md#session-lifecycle-invariants) |
| Hub APIs, auth, sync, notifications | [hub/README.md](hub/README.md) |
| Web routes, components, data fetching | [web/README.md](web/README.md); for optional feature discovery, [FUE](web/README.md#first-user-experience-fue) |
| Shared wire types and validation | `shared/src/types.ts`, `schemas.ts`, `socket.ts`, `modes.ts` |
| Client API contract | [client contract](docs/api/client-contract/index.md) |
| Optional encrypted push relay compatibility | [relay/README.md](relay/README.md) |
| User docs / marketing site | `docs/` (VitePress) / `website/` |

## Repository conventions

- Bun workspaces: `cli`, `shared`, `hub`, `web`, `website`, `docs`, `relay`. Run workspace scripts from the root; package-scoped commands may use `bun run --cwd <package> ...` or that package's directory. This fork intentionally does not contain the upstream `ios/` or `android/` projects.
- TypeScript strict; keep code typed. Prefer 4-space indentation. `@/*` resolves to a package's `src/*`.
- Shared protocol is `@hapi/protocol`; runtime schemas live in `shared/src/schemas.ts` (Zod).
- No backward compatibility required for formats changed by the task; do not add compatibility layers or change unrelated formats.

## Cross-component invariants

- CLI↔hub uses Socket.IO `/cli` with the CLI access token. Web terminals use `/terminal` with a client JWT; ordinary Web/PWA updates use REST + SSE. Preserve namespace isolation (`CLI_API_TOKEN:<namespace>`).
- Metadata/state updates are versioned; preserve stale-update rejection. Permission controls use per-flavor catalogs in `shared/src/modes.ts`, further constrained by session capabilities.
- `shared/fixtures/**` is generated from the web chat pipeline. Never hand-edit fixtures. For changes to fixture inputs or generation (paths in [.github/workflows/fixtures.yml](.github/workflows/fixtures.yml)), run `bun run gen:fixtures` and include any generated changes in the deliverable. CI checks drift and Web conformance on fixture changes.

## Verification and completion

Local checks cover changed behavior with targeted tests and necessary typechecks. Choose and report a focused scope for the affected components, based on the change's impact rather than the number of workflow steps.

- The full test suite runs in GitHub CI. Run `bun run test` locally, or an equivalent full sweep of all packages, ONLY when the user separately and explicitly requests a full local test run. Changes to shared contracts or multiple packages and a general request such as «проверь» do not grant that authorization.
- Do not replace a full run with a sequence of complete package suites or another equally heavy mandatory local sweep. Select test files or cases for affected behavior and only the necessary typechecks. This policy applies to workers, integration, and work explicitly assigned to the main checkout. Existing CI monitoring and gates remain unchanged.

| Change | Verification |
|--------|--------------|
| Documentation only | Check edited content, local links, and diff; no code test suite. |
| Package-local code | Targeted tests for changed behavior and the package's typecheck where available. Add regression coverage when needed. |
| Shared contracts, dependencies, broad cross-package behavior | Targeted tests for affected behavior and contract consumers, necessary typechecks for affected packages, and integration/conformance checks selected for the change. No automatic full local test run. |

- Root scripts: `bun run test:<package>` for `cli`, `hub`, `web`, `shared`, `relay`, with file or case filters for targeted runs. Use `bun run typecheck:<package>` for necessary checks in `cli`, `hub`, `web`, `relay`. Shared types are checked through affected consumers. CLI/web tests use Vitest. Hub/shared/relay use Bun test.
- Within this targeted scope and existing permissions, run and retry local checks without asking at each step. Fix failures caused by the task; report unrelated failures. If tools or permissions are unavailable, complete other work and state what remains unverified; do not bootstrap native toolchains or wait on CI unless the task requires it.
- Reuse passing checks when code, dependencies, and environment are unchanged; commit/push/PR transitions alone do not require reruns.
- Review this task's changes for correctness, security, and regressions. For local work, inspect unstaged/staged diffs (`git diff`, `git diff --cached`) and new files; for a branch/PR review, use the actual target branch's merge-base diff. Local self-review does not require a GitHub event, remote review, or posting comments.
