import { z } from 'zod'

export const CLOSE_SESSION_DESCRIPTION = 'Close and archive this HAPI session after the current turn finishes. Call only after the user accepts the delivered change and all required checks, commits and ready markers are complete. Call as the last tool, then send your final reply. The final messages are flushed before closing, and the session is marked read through those messages. New user input cancels the pending close. History remains available for inspection and reopening. Takes no session ID and cannot close a peer.'

export const closeSessionSchema = z.object({}).strict()
