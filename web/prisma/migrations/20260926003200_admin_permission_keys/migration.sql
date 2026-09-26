-- users.manage, permissions.manage, playlists.generate, labs.mosaic and terminal.control replace hard-wired ADMIN
-- role checks. ADMIN holds every permission implicitly and needs no rows. The one non-admin default that must
-- survive is the album mosaic, which used to admit MANAGER as well (requireRoleAtLeast('MANAGER')).
INSERT INTO "RolePermission" ("role", "permission")
VALUES ('MANAGER', 'labs.mosaic')
ON CONFLICT ("role", "permission") DO NOTHING;
