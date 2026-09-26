// The connection string the web app's own Prisma client uses: WEB_DATABASE_URL (the least-privilege `dmp_web` role, see
// scripts/sql/create_web_role.sql) when set, otherwise Prisma's usual DATABASE_URL. `undefined` leaves the client on
// DATABASE_URL. Migrations, the Rust scripts and backups never come through here - they keep the owner role in
// DATABASE_URL, which is the point of having two.
export const webDatabaseUrl = (env: NodeJS.ProcessEnv = process.env): string | undefined => env.WEB_DATABASE_URL?.trim() || undefined
