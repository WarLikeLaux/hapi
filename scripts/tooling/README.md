# HAPI UI captures

Run these commands from your claimed slot. Use its real web app and the running hub. The same script works for every agent model and does not require a browser MCP tool.

## Start the preview

Confirm your edited source is in this slot, then start Vite on a free port:

```bash
bun run --cwd web dev -- --port 5174 --strictPort
```

Keep the server running while capturing. Use the same port in every capture command. `--strictPort` prevents accidentally using another checkout's preview. Vite proxies `/api` to `http://127.0.0.1:3006`. Set `VITE_HUB_PROXY` on the dev server if your hub uses a different address. This starts a preview, not a deployment.

## Capture the changed state

```bash
bun scripts/tooling/capture-hapi-ui.mjs --help

# A session menu. Replace <id> with a real HAPI session UUID.
bun scripts/tooling/capture-hapi-ui.mjs \
  --url 'http://127.0.0.1:5174/sessions/<id>' \
  --click 'button[title="More actions"]' \
  --expect '[role="menuitem"]:has-text("Delete")' \
  --out /tmp/hapi-session-menu.png

# A setting far down a nested scrolling page. The helper brings it into frame.
bun scripts/tooling/capture-hapi-ui.mjs \
  --url http://127.0.0.1:5174/settings/display \
  --expect 'input[aria-label="External editor"]' \
  --out /tmp/hapi-external-editor.png

# Create Session on a desktop viewport.
bun scripts/tooling/capture-hapi-ui.mjs \
  --url http://127.0.0.1:5174/sessions/new \
  --width 1280 --height 720 \
  --expect 'text=Directory' \
  --out /tmp/hapi-new-session.png
```

Actions run in argument order. Repeat `--click` for multiple menus. `--fill '<selector>' '<text>'` fills an input, `--press '<selector>' 'Enter'` presses a key, `--hover '<selector>'` reveals hover controls, `--scroll '<selector>'` brings an intermediate element into view, and `--wait '<selector>'` waits for intermediate content. `--dismiss '<selector>'` clicks an optional overlay if it appears within two seconds. These actions can change live hub data, so use read-only navigation or an authorized interaction.

`--expect` is the final assertion after all actions. Choose a specific changed control, message, or menu item. The helper scrolls to its first match and requires the entire element to fit in the viewport, including clipping by nested scrollers. Large containers need a narrower selector or larger `--width` / `--height`. `--absent '<selector>'` waits for unwanted UI to become hidden. Defaults are 390 × 844. The output must be an absolute `.png` path. Parent directories are created automatically. Success prints JSON with the URL, PNG path, viewport, and byte count. Failures exit nonzero.

After every capture, open the actual saved PNG with an image-reading tool and compare it with the user's requested change. Confirm the correct page, changed element, relevant data, and intended state, with enough surrounding context and no clipping or obstructing overlays. A successful command, selector assertion, or `display_image` call does not count as visual inspection. If the screenshot shows the wrong content or does not demonstrate the change, correct the preview, interactions, selector, or framing and retake it before claiming completion. If you cannot read images, explicitly report that visual verification is blocked.

Send all final screenshots for the task with HAPI `display_image` using their absolute paths. Cover the reviewed pages, viewports, and states instead of selecting one representative image. Failed or superseded draft captures do not need to be sent. Give final images distinct filenames and label what each demonstrates. Wait for visual acceptance as required by AGENTS.md. If the model lacks that MCP tool, use the existing shell fallback inside its HAPI session for each final image:

```bash
bun scripts/tooling/hapi-display-image.mjs /tmp/hapi-external-editor.png
```

## Custom Playwright scenarios

Reuse `captureHapiUi` for interactions that need code. Save a scenario beside the helper or adjust the import path:

```js
import { captureHapiUi } from './hapi-ui.mjs'

console.log(JSON.stringify(await captureHapiUi({
    url: 'http://127.0.0.1:5174/settings/display',
    out: '/tmp/hapi-editor-validation.png',
    expect: 'input[aria-label="External editor"]',
    interact: async (page) => {
        await page.getByRole('textbox', { name: 'External editor', exact: true }).fill('invalid-url')
    },
})))
```

`prepare(page)` runs before navigation, for example to install `page.route` with API fixtures. `interact(page)` runs after navigation and any `steps` actions. Both receive an authenticated Playwright page. The helper owns browser cleanup, page load checks, final framing, and screenshot saving. `capture-limits-stale.mjs` demonstrates API fixtures. Clearly identify mocked data when presenting such a capture. Mocking an API response does not verify new backend behavior.

## Authentication and failures

The helper reads the CLI access token from `HAPI_ACCESS_TOKEN`, then `CLI_API_TOKEN`, then `cliApiToken` in `HAPI_SETTINGS_PATH` (default `~/.hapi/settings.json`). It installs the token only for the exact preview origin. The preview URL must use HTTP(S) on `127.0.0.1`, `localhost`, or `[::1]`. Tokens are not printed.

- **Connection refused:** start the slot's Vite server and check its chosen port. If Vite reports proxy failures, check the running hub and `VITE_HUB_PROXY`.
- **Login screen / 401:** check which token source the helper uses and that it belongs to the hub's namespace. Use the CLI access token, not a client JWT.
- **CORS failure:** use the Vite URL as the page origin and its `/api` proxy. Do not set `hapi_hub_url` to the backend port or weaken CORS. The helper clears that override.
- **Selector timeout:** confirm the page, locale, viewport, and selector. Use `--hover`, `--scroll`, or ordered actions when needed. A newly added backend route will not exist on the deployed hub until integration.
- **Viewport assertion:** choose the actual changed control instead of a large enclosing section, or increase the viewport. Do not treat DOM presence as visual proof.
- **Missing Chromium:** use the repository's installed Playwright. If its browser is missing, report the prerequisite or install it within the task's existing permissions with `bunx playwright install chromium`.
