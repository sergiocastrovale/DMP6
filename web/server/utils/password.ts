import bcrypt from 'bcrypt'

const ROUNDS = 12

export const hashPassword = (plain: string): Promise<string> => {
  return bcrypt.hash(plain, ROUNDS)
}

export const verifyPassword = (plain: string, hash: string): Promise<boolean> => {
  return bcrypt.compare(plain, hash)
}

// Compare against this when the username doesn't exist, so an unknown-username login takes the same
// bcrypt-compare time as a real one — no timing oracle for enumerating valid usernames.
export const DUMMY_PASSWORD_HASH = bcrypt.hashSync('dmp-dummy-password-for-timing-parity', ROUNDS)
