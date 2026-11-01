import { readFile } from 'node:fs/promises'
import { join, sep } from 'node:path'
import { getHapiBlobsDir } from '@/constants/uploadPaths'
import { getProjectPath } from './path'

export {
    applySessionTitleFallback,
    createSessionTitleFallback,
} from '@/modules/common/sessionTitleFallback'
/** Drop the @path references prepended for uploads; upload filenames contain no whitespace. */
export function stripAttachmentReferences(message: string): string {
    const prefix = `@${getHapiBlobsDir()}${sep}`
    return message.split(/(\s+)/).filter((part) => !part.startsWith(prefix)).join('')
}

/** Latest Claude Code ai-title from the session transcript, or null. */
export async function readNativeSessionTitle(workingDirectory: string, sessionId: string): Promise<string | null> {
    let content: string
    try {
        content = await readFile(join(getProjectPath(workingDirectory), `${sessionId}.jsonl`), 'utf8')
    } catch {
        return null
    }

    let title: string | null = null
    for (const line of content.split('\n')) {
        if (!line.includes('"ai-title"')) continue
        try {
            const entry = JSON.parse(line)
            if (entry.type === 'ai-title' && typeof entry.aiTitle === 'string') title = entry.aiTitle
        } catch {
            // Partial trailing line while Claude is still writing.
        }
    }
    return title
}
