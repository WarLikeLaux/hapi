#!/usr/bin/env bun
import { captureHapiUi } from './hapi-ui.mjs'

const help = `Capture the real HAPI UI through a slot's local Vite proxy.

Usage:
  bun scripts/tooling/capture-hapi-ui.mjs --url <loopback-url> --out </absolute/path.png> --expect <selector>

Options:
  --profile <phone|desktop>         Measured device viewport and pixel ratio (default: phone)
  --width <pixels> --height <pixels>  Custom viewport (minimum: 200)
  --theme <telegram|native>         Recorded Telegram/dark theme (default) or clean browser
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
        const options = { steps: [], theme: 'telegram', colorScheme: 'dark' }
        const singles = new Set(['--url', '--out', '--expect', '--absent', '--width', '--height', '--profile', '--theme'])
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
        const profiles = {
            phone: { width: 361, height: 738, deviceScaleFactor: 3.5 },
            desktop: { width: 1872, height: 928, deviceScaleFactor: 2 },
        }
        if (!options.profile && options.width === undefined && options.height === undefined) options.profile = 'phone'
        if (options.profile) {
            if (!Object.hasOwn(profiles, options.profile)) throw new Error('Profile must be phone or desktop')
            const profile = profiles[options.profile]
            options.width ??= profile.width
            options.height ??= profile.height
            options.deviceScaleFactor = profile.deviceScaleFactor
            delete options.profile
        }
        if (options.theme === 'native') delete options.colorScheme
        console.log(JSON.stringify(await captureHapiUi(options)))
    }
} catch (error) {
    console.error(`capture-hapi-ui: ${error.message}`)
    process.exitCode = 1
}
