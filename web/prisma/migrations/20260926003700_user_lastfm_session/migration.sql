-- Last.fm sessions move from the one global Settings row to a per-user table, so each user's counted listens scrobble
-- to their own account. Additive: the old Settings.lastfmSessionKey/lastfmUsername columns stay (never read again).
CREATE TABLE "UserLastfmSession" (
    "userId" INTEGER NOT NULL,
    "sessionKey" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserLastfmSession_pkey" PRIMARY KEY ("userId")
);

ALTER TABLE "UserLastfmSession" ADD CONSTRAINT "UserLastfmSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
