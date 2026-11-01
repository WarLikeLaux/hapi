import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { Hono } from 'hono'
import type { WebAppEnv } from '../middleware/auth'

const execFileAsync = promisify(execFile)
const command = `Add-Type -TypeDefinition 'using System.Runtime.InteropServices; public static class HapiMediaKey { [DllImport("user32.dll")] public static extern void keybd_event(byte key, byte scan, uint flags, System.UIntPtr extra); }'; [HapiMediaKey]::keybd_event(0xB3,0,0,[UIntPtr]::Zero); [HapiMediaKey]::keybd_event(0xB3,0,2,[UIntPtr]::Zero)`

export function createWindowsMediaRoutes(): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()
    app.post('/windows-media/play-pause', async (c) => {
        try {
            await execFileAsync('/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',
                ['-NoProfile', '-NonInteractive', '-Command', command], { timeout: 5000 })
            return c.json({ ok: true })
        } catch {
            return c.json({ error: 'Windows media control is unavailable' }, 503)
        }
    })
    return app
}
