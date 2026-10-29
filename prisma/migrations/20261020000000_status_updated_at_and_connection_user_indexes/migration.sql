-- Justified indexes (audit 2026-10-20):

-- 1) ScheduledPin(status, updatedAt)
--    The worker's daily purge loop runs
--      findMany({ status IN (published,canceled,failed_final), updatedAt < cutoff }, take 5000)
--    repeatedly until empty. With only (status, scheduledFor) / (connectionId, status, publishedAt)
--    available, every iteration re-visits a large share of the table's heap rows (the final-status
--    pins ARE most of the table), which makes retention lag as the table grows.
--    The orphan-recovery scan ({ status: 'publishing', updatedAt < 2min }) also filters on exactly
--    this pair and runs every 60s.
CREATE INDEX "ScheduledPin_status_updatedAt_idx" ON "ScheduledPin"("status", "updatedAt");

-- 2) PinterestConnection(userId)
--    Every dashboard load, analytics fetch, and the OAuth callback filter
--    findMany({ userId }) on this table, and the userId FK had no index
--    (full scan per lookup; also needed for the User->connections cascade).
CREATE INDEX "PinterestConnection_userId_idx" ON "PinterestConnection"("userId");
