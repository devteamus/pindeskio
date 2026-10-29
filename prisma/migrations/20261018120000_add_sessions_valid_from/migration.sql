-- AlterTable
-- Tokens issued before this timestamp are rejected. Set on logout and on password
-- reset so a leaked/stolen signed session token stops working immediately instead of
-- staying valid for its full 7-day lifetime. Nullable: existing users are unaffected.
ALTER TABLE "User" ADD COLUMN "sessionsValidFrom" TIMESTAMP(3);
