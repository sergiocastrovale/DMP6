-- issues.view used to authorize both reading the /issues list and every write behind it (queueing fixes,
-- editing proposed values, undoing fixes, ./fix which rewrites audio tags, clearing fix history). Writes now
-- need issues.fix (and history deletion issues.admin). Grant the new keys to every role that currently holds
-- issues.view so nobody's access changes on deploy; an admin can then narrow it in Settings -> Permissions.
-- ADMIN holds every permission implicitly and needs no rows.
INSERT INTO "RolePermission" ("role", "permission")
SELECT "role", 'issues.fix' FROM "RolePermission" WHERE "permission" = 'issues.view' AND "role" <> 'ADMIN'
ON CONFLICT ("role", "permission") DO NOTHING;

INSERT INTO "RolePermission" ("role", "permission")
SELECT "role", 'issues.admin' FROM "RolePermission" WHERE "permission" = 'issues.view' AND "role" <> 'ADMIN'
ON CONFLICT ("role", "permission") DO NOTHING;
