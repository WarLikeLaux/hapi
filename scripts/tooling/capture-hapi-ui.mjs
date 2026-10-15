#!/usr/bin/env bun
import { captureHapiUi } from './hapi-ui.mjs'

const help = `Capture the real HAPI UI through a slot's local Vite proxy.

Usage:
  bun scripts/tooling/capture-hapi-ui.mjs --url <loopback-url> --out </absolute/path.png> --expect <selector>

Options:
  --width <pixels> --height <pixels>  Viewport (default: 390 x 844, minimum: 200)
  --absent <selector>               Wait until the unwanted UI is hidden
  --help                            Show this help without launching a browser

Actions (repeatable, executed in argument order before --expect):
  --dismiss <selector>              Click an optional overlay if it appears
  --click <selector>                Click an element
  --fill <selector> <text>          Fill an input (quote selectors and text)
  --press <selector> <key>          Press a key, e.g. Enter or End
  --hover <selector>                Reveal hover actions
  --scroll <selector>               Scroll an element into view
  --wait <selector>                 Wait for an intermediate element

The --expect element is scrolled into view and must fit fully in the viewport.
Use a specific control or message, not a container taller than the screen.
Auth: HAPI_ACCESS_TOKEN, then CLI_API_TOKEN, then cliApiToken in
HAPI_SETTINGS_PATH (default: ~/.hapi/settings.json). Tokens are never printed.
For custom scenarios import captureHapiUi from scripts/tooling/hapi-ui.mjs.
See scripts/tooling/README.md for examples and troubleshooting.`

try {
    const args = process.argv.slice(2)
    if (args.length === 1 && args[0] === '--help') {
        console.log(help)
    } else {
        const options = { steps: [] }
        const singles = new Set(['--url', '--out', '--expect', '--absent', '--width', '--height'])
        const actions = new Set(['--dismiss', '--click', '--fill', '--press', '--hover', '--scroll', '--wait'])
        const seen = new Set()
        for (let i = 0; i < args.length; i++) {
            const key = args[i]
            if (!singles.has(key) && !actions.has(key)) throw new Error(`Unknown argument: ${key}. Use --help.`)
            const value = args[++i]
            if (!value || value.startsWith('--')) throw new Error(`Missing value for ${key}`)
            if (actions.has(key)) {
                const step = { action: key.slice(2), selector: value }
                if (key === '--fill' || key === '--press') {
                    step.value = args[++i]
                    if (step.value === undefined || step.value.startsWith('--')) throw new Error(`Missing text/key for ${key}`)
                }
                options.steps.push(step)
            } else {
                if (seen.has(key)) throw new Error(`Duplicate argument: ${key}`)
                seen.add(key)
                options[key.slice(2)] = key === '--width' || key === '--height' ? Number(value) : value
            }
        }
        if (!options.url || !options.out || !options.expect) throw new Error('Required: --url, --out, --expect. Use --help.')
        console.log(JSON.stringify(await captureHapiUi(options)))
    }
} catch (error) {
    console.error(`capture-hapi-ui: ${error.message}`)
    process.exitCode = 1
}
