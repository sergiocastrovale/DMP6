import { z } from 'zod'
import { isValidSessionName } from '~/server/utils/terminalCommand'

const session = z.string().refine(isValidSessionName, 'Invalid session')

export const terminalSessionBodySchema = z.object({ session })

// Whether `command` is allowed is decided by the route (its message names the command).
export const terminalRunBodySchema = z.object({
  command: z.string().min(1, 'is required'),
  args: z.array(z.string()).optional(),
  session,
})

export const unlockBodySchema = z.object({
  signalOwn: z.boolean().optional().default(true),
})
