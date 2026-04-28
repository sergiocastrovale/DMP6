import bcrypt from 'bcrypt'

const ROUNDS = 12

export const hashPassword = (plain: string): Promise<string> => {
  return bcrypt.hash(plain, ROUNDS)
}

export const verifyPassword = (plain: string, hash: string): Promise<boolean> => {
  return bcrypt.compare(plain, hash)
}
