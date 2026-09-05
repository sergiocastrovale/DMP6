-- The toast/sidebar terminal setting is gone: every terminal action now always starts as a toast
-- and can be expanded to the sidebar on demand, so there is nothing left for this flag to choose.
ALTER TABLE "Settings" DROP COLUMN "showTerminal";
