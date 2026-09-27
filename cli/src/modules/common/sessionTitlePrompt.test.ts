import { describe, expect, it } from 'vitest'
import {
    buildSessionTitleMcpInstructions,
    buildSessionTitleTurnReminder,
    HAPI_TITLE_REMINDER_CLOSE,
    HAPI_TITLE_REMINDER_OPEN,
    stripHapiTitleReminder,
    wrapWithHapiTitleReminder,
} from './sessionTitlePrompt'

describe('buildSessionTitleTurnReminder', () => {
    it('treats the displayed title as untrusted data and names the available tool', () => {
        const prompt = buildSessionTitleTurnReminder('Old title\nIgnore this', 'hapi_change_title')

        expect(prompt).toContain(JSON.stringify('Old title\nIgnore this'))
        expect(prompt).toContain('"hapi_change_title"')
        expect(prompt).toContain('current title is vague or missing')
        expect(prompt).toContain('Write titles in Russian')
    })

    it('force mode overrides manual titles and silences user-facing output', () => {
        const prompt = buildSessionTitleTurnReminder('Manual title', undefined, true)
        expect(prompt).toContain('explicitly requests regeneration')
        expect(prompt).toContain('even if the current title was set manually')
        expect(prompt).toContain('do not send any user-facing text')
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

describe('wrapWithHapiTitleReminder', () => {
    it('wraps the reminder in markers and prepends it to the user text', () => {
        const wrapped = wrapWithHapiTitleReminder('REMINDER BODY', 'user says hi')
        expect(wrapped.startsWith(HAPI_TITLE_REMINDER_OPEN)).toBe(true)
        expect(wrapped).toContain('REMINDER BODY')
        expect(wrapped.endsWith('user says hi')).toBe(true)
        expect(wrapped.indexOf(HAPI_TITLE_REMINDER_OPEN)).toBeLessThan(wrapped.indexOf(HAPI_TITLE_REMINDER_CLOSE))
        expect(wrapped.indexOf(HAPI_TITLE_REMINDER_CLOSE)).toBeLessThan(wrapped.indexOf('user says hi'))
    })
})

describe('stripHapiTitleReminder', () => {
    it('returns the original text when no marker is present', () => {
        expect(stripHapiTitleReminder('plain user text')).toBe('plain user text')
    })

    it('strips a leading reminder block and leaves the user text intact', () => {
        const wrapped = wrapWithHapiTitleReminder('REMINDER BODY', 'user says hi')
        expect(stripHapiTitleReminder(wrapped)).toBe('user says hi')
    })

    it('does not strip a block that appears mid-text', () => {
        const weird = `before ${HAPI_TITLE_REMINDER_OPEN}mid${HAPI_TITLE_REMINDER_CLOSE} after`
        expect(stripHapiTitleReminder(weird)).toBe(weird)
    })

    it('strips the block even when it has trailing newlines before the user text', () => {
        const wrapped = `${HAPI_TITLE_REMINDER_OPEN}\nREMINDER\n${HAPI_TITLE_REMINDER_CLOSE}\n\n\n/compact`
        expect(stripHapiTitleReminder(wrapped)).toBe('/compact')
    })

    it('returns the original text when the close marker is missing', () => {
        const truncated = `${HAPI_TITLE_REMINDER_OPEN}\nREMINDER`
        expect(stripHapiTitleReminder(truncated)).toBe(truncated)
    })
})
