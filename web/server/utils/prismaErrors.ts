// Duck-typed Prisma error code check (matches the pattern already used in promote.ts) - avoids
// importing PrismaClientKnownRequestError just to read `.code`.
const isPrismaErrorCode = (e: unknown, code: string): boolean =>
  typeof e === 'object' && e !== null && (e as { code?: string }).code === code

// P2002: unique constraint violation (e.g. a row that already exists for this key).
export const isUniqueConstraintError = (e: unknown): boolean => isPrismaErrorCode(e, 'P2002')

// P2003: foreign key constraint violation (e.g. the referenced id doesn't exist).
export const isForeignKeyError = (e: unknown): boolean => isPrismaErrorCode(e, 'P2003')
