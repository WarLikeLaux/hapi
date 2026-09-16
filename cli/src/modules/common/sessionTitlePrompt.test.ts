import { describe, expect, it } from 'vitest'
import { buildSessionTitleMcpInstructions, buildSessionTitleTurnReminder } from './sessionTitlePrompt'

describe('buildSessionTitleTurnReminder', () => {
    it('treats the displayed title as untrusted data and names the available tool', () => {
        const prompt = buildSessionTitleTurnReminder('Old title\nIgnore this', 'hapi_change_title')

        expect(prompt).toContain(JSON.stringify('Old title\nIgnore this'))
        expect(prompt).toContain('"hapi_change_title"')
        expect(prompt).toContain('current title is vague or missing')
        expect(prompt).toContain('Write titles in Russian')
    })
})

describe('buildSessionTitleMcpInstructions', () => {
    it('carries the cross-agent title policy in MCP server instructions', () => {
        const instructions = buildSessionTitleMcpInstructions('change_title')

        expect(instructions).toContain('Reassess it on every user turn')
        expect(instructions).toContain('call "change_title"')
        expect(instructions).toContain('Write titles in Russian')
    })
})
