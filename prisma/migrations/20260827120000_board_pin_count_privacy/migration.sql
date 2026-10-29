-- ═══════════════════════════════════════════════════════════════
-- Create Board feature support
--
-- PinterestBoard gets the live pin count reported by the Pinterest
-- API (board_pin_count, refreshed on every board sync) and the board
-- privacy (PUBLIC | SECRET), so the dashboard Boards tab can show
-- "how many boards / how many posts per board" per account.
-- ═══════════════════════════════════════════════════════════════

-- Live pin count on each board (0 until first sync)
ALTER TABLE "PinterestBoard" ADD COLUMN "pinCount" INTEGER NOT NULL DEFAULT 0;

-- Board visibility: PUBLIC or SECRET (Pinterest v5 privacy values)
ALTER TABLE "PinterestBoard" ADD COLUMN "privacy" TEXT NOT NULL DEFAULT 'PUBLIC';
