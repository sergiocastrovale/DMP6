-- Per-user API keys for the Subsonic (/rest/*) API. See CLAUDE.md Data Model / docs/feature_subsonic.md.

ALTER TYPE "PlaySource" ADD VALUE 'SUBSONIC';

CREATE TABLE "UserApiKey" (
    "id"         TEXT NOT NULL,
    "userId"     INTEGER NOT NULL,
    "name"       TEXT NOT NULL,
    "keyHash"    TEXT NOT NULL,
    "prefix"     TEXT NOT NULL,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt"  TIMESTAMP(3),

    CONSTRAINT "UserApiKey_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserApiKey_keyHash_key" ON "UserApiKey"("keyHash");
CREATE INDEX "UserApiKey_userId_idx" ON "UserApiKey"("userId");

ALTER TABLE "UserApiKey" ADD CONSTRAINT "UserApiKey_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
