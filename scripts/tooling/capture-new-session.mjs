#!/usr/bin/env bun
// Convenience capture of /sessions/new. Uses the same auth and framing as the CLI.
import { captureHapiUi } from './hapi-ui.mjs'

const args = process.argv.slice(2)
const values = new Map()
for (let i = 0; i < args.length; i += 2) {
    const key = args[i]
    const value = args[i + 1]
    if (!['--url', '--out', '--width', '--height'].includes(key) || !value || value.startsWith('--') || values.has(key)) {
        throw new Error('Usage: capture-new-session.mjs --out /tmp/new-session.png [--url http://127.0.0.1:5174] [--width 1280] [--height 720]')
    }
    values.set(key, value)
}

console.log(JSON.stringify(await captureHapiUi({
    url: new URL('/sessions/new', values.get('--url') ?? 'http://127.0.0.1:5174').href,
    out: values.get('--out'),
    width: Number(values.get('--width') ?? 1280),
    height: Number(values.get('--height') ?? 720),
    expect: 'text=Directory',
})))
