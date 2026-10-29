-- 48-hour scheduling horizon: PostgreSQL is the source of truth, Redis/BullMQ
-- is only the execution queue.
--
-- 1) ScheduledPin.dispatchedAt
--    NULL  -> the pin needs a BullMQ job for its current scheduledFor; the
--             dispatcher claims exactly these rows every cycle.
--    set   -> a job is (or was just) enqueued for the current scheduledFor.
--    Any change of scheduledFor, or any transition back into
--    queued/retry_waiting, resets it to NULL (application code guarantees
--    this invariant) so the pin re-enters the dispatcher's claim set.
ALTER TABLE "ScheduledPin" ADD COLUMN "dispatchedAt" TIMESTAMP(3);

-- 2) Partial index for the dispatcher's atomic claim query:
--      UPDATE "ScheduledPin" SET "dispatchedAt" = now()
--      WHERE id IN (
--        SELECT id FROM "ScheduledPin"
--        WHERE status IN ('queued','retry_waiting')
--          AND "dispatchedAt" IS NULL
--          AND "scheduledFor" <= now() + horizon
--        ORDER BY "scheduledFor" ASC
--        LIMIT $batch
--        FOR UPDATE SKIP LOCKED
--      )
--    Only undispatched actionable pins live in this index, so a dispatch
--    cycle never scans the dispatched/published/final majority of the table
--    no matter how large the table grows. Prisma cannot express partial
--    indexes, hence the raw SQL here.
CREATE INDEX "ScheduledPin_dispatch_pending_idx"
  ON "ScheduledPin"("scheduledFor")
  WHERE status IN ('queued', 'retry_waiting') AND "dispatchedAt" IS NULL;

-- 3) Existing queued/retry_waiting rows: dispatchedAt defaults to NULL, which
--    is exactly right — the first dispatcher cycle after deploy re-ensures a
--    job for every actionable pin (a no-op re-add for pins whose jobs already
--    exist in Redis, since jobIds are deterministic pinIds).
