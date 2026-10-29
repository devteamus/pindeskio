-- AlterTable
-- Adds a nullable `disconnectedAt` timestamp used by the new soft-delete
-- flow for Pinterest connections. Disconnecting an account no longer
-- deletes the row (which used to wipe out publish history and let users
-- bypass the per-account daily limit and the plan's account cap by
-- disconnecting + reconnecting). It now just marks the row as
-- status = 'disconnected' and stamps disconnectedAt.
ALTER TABLE "PinterestConnection" ADD COLUMN "disconnectedAt" TIMESTAMP(3);
