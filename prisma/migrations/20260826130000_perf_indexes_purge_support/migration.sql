-- ═══════════════════════════════════════════════════════════════
-- Performance indexes + storage purge support + 429 backoff column
--
-- Target scale: ~3,300 connected Pinterest accounts, up to ~660k
-- pins/day. Without these indexes every worker publish does a
-- full-table COUNT, the reconciler seq-scans, dashboard listing
-- seq-scans, and the daily purge job can't keep up.
-- ═══════════════════════════════════════════════════════════════

-- ── ScheduledPin: hot-path indexes ──────────────────────────────
-- Worker daily-limit check (COUNT per connectionId/status/publishedAt)
CREATE INDEX "ScheduledPin_connectionId_status_publishedAt_idx" ON "ScheduledPin"("connectionId", "status", "publishedAt");

-- Reconciler: find due queued pins (status + scheduledFor)
CREATE INDEX "ScheduledPin_status_scheduledFor_idx" ON "ScheduledPin"("status", "scheduledFor");

-- Dashboard pin listing / history (userId + createdAt)
CREATE INDEX "ScheduledPin_userId_createdAt_idx" ON "ScheduledPin"("userId", "createdAt");

-- Batch status breakdown (groupBy batchId) + FK SetNull when an
-- ImportBatch is deleted by the purge job
CREATE INDEX "ScheduledPin_batchId_idx" ON "ScheduledPin"("batchId");

-- ── ImportRow: FK cascade lookup (batch delete cascades rows) ──
-- Postgres does NOT auto-index FK columns; without this every batch
-- delete seq-scans the whole ImportRow table.
CREATE INDEX "ImportRow_batchId_idx" ON "ImportRow"("batchId");

-- ── ImportBatch: purge job (createdAt older than N days) ────────
CREATE INDEX "ImportBatch_createdAt_idx" ON "ImportBatch"("createdAt");

-- ── ApiCallLog: purge job (createdAt older than N days) ─────────
CREATE INDEX "ApiCallLog_createdAt_idx" ON "ApiCallLog"("createdAt");

-- ── PasswordResetOtp: purge expired OTPs ────────────────────────
CREATE INDEX "PasswordResetOtp_expiresAt_idx" ON "PasswordResetOtp"("expiresAt");

-- ── AuditLog: bounded retention ─────────────────────────────────
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- ── ScheduledPin: consecutive Pinterest 429 backoff counter ─────
-- Drives exponential backoff in the worker when Pinterest rate
-- limits (429). Resets on any real outcome; never causes
-- failed_final on its own.
ALTER TABLE "ScheduledPin" ADD COLUMN "consecutiveRateLimits" INTEGER NOT NULL DEFAULT 0;
