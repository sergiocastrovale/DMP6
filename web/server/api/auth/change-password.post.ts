import { prisma } from '~/server/utils/prisma'
import { hashPassword, verifyPassword } from '~/server/utils/password'

export default defineEventHandler(async (event) => {
  const user = event.context.user
  if (!user) {
    throw createError({ statusCode: 401, message: 'Unauthorized' })
  }

  const { currentPassword, newPassword } = (await readBody(event)) ?? {}
  if (!currentPassword || !newPassword) {
    throw createError({ statusCode: 400, message: 'Missing fields' })
  }
  if (typeof newPassword !== 'string' || newPassword.length < 6) {
    throw createError({ statusCode: 400, message: 'Password must be at least 6 characters' })
  }

  const dbUser = await prisma.user.findUnique({ where: { id: user.id } })
  if (!dbUser) {
    throw createError({ statusCode: 401, message: 'Unauthorized' })
  }

  const ok = await verifyPassword(currentPassword, dbUser.passwordHash)
  if (!ok) {
    throw createError({ statusCode: 401, message: 'Current password incorrect' })
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await hashPassword(newPassword),
      mustChangePassword: false,
    },
  })

  return { ok: true }
})
