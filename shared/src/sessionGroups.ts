import { z } from 'zod'

export const SessionGroupMemberSchema = z.object({
    sessionId: z.string().min(1),
    pinned: z.boolean(),
})
export const SessionGroupSchema = z.object({
    id: z.string(),
    name: z.string(),
    version: z.number().int().positive(),
    updatedAt: z.number(),
    members: z.array(SessionGroupMemberSchema),
})
export const CreateSessionGroupSchema = z.object({ name: z.string().trim().min(1).max(120) })
export const UpdateSessionGroupSchema = CreateSessionGroupSchema.extend({
    version: z.number().int().positive(),
    members: z.array(SessionGroupMemberSchema).max(2000),
}).refine(value => new Set(value.members.map(member => member.sessionId)).size === value.members.length, 'Duplicate chats')
export type SessionGroup = z.infer<typeof SessionGroupSchema>
export type UpdateSessionGroup = z.infer<typeof UpdateSessionGroupSchema>
